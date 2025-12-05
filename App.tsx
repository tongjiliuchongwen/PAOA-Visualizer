import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  generateRandomRegularGraph,
  generateCompleteGraph,
  generateErdosRenyi,
  precalculateLayout,
  GraphData,
} from "./graph-utils";
import {
  getCircuitGenerator,
  runCircuit,
  runCircuitStepByStep,
  cutSize,
  avCutSize,
  getRandomParams,
  spsaStep,
  OptimizationState,
  AlgorithmType,
  StepInfo
} from "./paoa";
import {
  AreaChart,
  Area,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { 
  Play, 
  RotateCcw, 
  Activity, 
  Cpu, 
  Zap,
  Microscope,
  Network,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Scissors
} from "lucide-react";

const NODE_RADIUS = 12;

type AppPhase = 'idle' | 'training' | 'trained' | 'playing';
type GraphType = 'regular' | 'complete' | 'erdos';

interface RangeControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  disabled?: boolean;
}

const RangeControl: React.FC<RangeControlProps> = ({ label, value, min, max, step=1, onChange, disabled=false }) => (
  <div className={`mb-4 ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className="flex justify-between text-xs mb-1.5 font-medium text-slate-400">
          <span>{label}</span>
          <span className="text-cyan-400 font-mono">{value}</span>
      </div>
      <input 
        type="range" min={min} max={max} step={step}
        value={value} 
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 focus:outline-none"
      />
  </div>
);

export default function App() {
  // --- Configuration ---
  const [graphType, setGraphType] = useState<GraphType>('regular');
  const [numNodes, setNumNodes] = useState(12);
  const [degree, setDegree] = useState(3); 
  const [prob, setProb] = useState(0.3);
  
  const [algoType, setAlgoType] = useState<AlgorithmType>('reduced');
  const [layers, setLayers] = useState(1);
  const [numTrials, setNumTrials] = useState(40);
  const [maxIter, setMaxIter] = useState(100);

  // --- System State ---
  const [phase, setPhase] = useState<AppPhase>('idle');
  const [optState, setOptState] = useState<OptimizationState | null>(null);
  
  // currentBits is what is currently DRAWN on the screen.
  // It lags behind the simulation during animation steps.
  const [currentBits, setCurrentBits] = useState<number[]>([]);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  
  // --- Inspector / Visualization State ---
  const [inspectorStep, setInspectorStep] = useState<StepInfo | null>(null);
  const [stepCount, setStepCount] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [currentCutSize, setCurrentCutSize] = useState(0);
  const [animationPhase, setAnimationPhase] = useState<'before' | 'after'>('before'); // Track current part of animation

  // --- Refs ---
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const graphRef = useRef<GraphData | null>(null);
  const paramsRef = useRef<number[]>([]); 
  const inspectorGenRef = useRef<Generator<StepInfo> | null>(null);
  const playbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Initialization ---
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setCanvasSize({
          w: containerRef.current.clientWidth,
          h: containerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); 
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const initGraph = useCallback(() => {
    try {
      let g: GraphData;
      if (graphType === 'complete') g = generateCompleteGraph(numNodes);
      else if (graphType === 'erdos') g = generateErdosRenyi(numNodes, prob);
      else g = generateRandomRegularGraph(numNodes, degree);

      precalculateLayout(g, canvasSize.w || 800, canvasSize.h || 600, 300);

      setGraphData(g);
      graphRef.current = g;
      
      // Reset States
      setPhase('idle');
      setOptState(null);
      setCurrentBits(new Array(numNodes).fill(0));
      setCurrentCutSize(0);
      setInspectorStep(null);
      paramsRef.current = [];
      setStepCount(0);
      
      setTotalSteps(g.edges.length * layers);

      drawGraph(g, new Array(numNodes).fill(0), null, 'before');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error generating graph');
    }
  }, [graphType, numNodes, degree, prob, canvasSize, layers]);

  useEffect(() => {
    if (canvasSize.w > 0) initGraph();
  }, [initGraph, canvasSize.w]);

  // --- PHASE 1: Training (SPSA) ---
  const runTraining = async () => {
    if (!graphRef.current) return;
    setPhase('training');
    
    const g = graphRef.current;
    const initialParams = getRandomParams(algoType, layers, g.edges.length);
    let currentParams = initialParams;
    let history: { iter: number; cost: number }[] = [];
    
    // Generator Logic
    const genCircuit = getCircuitGenerator(algoType);
    const objective = (p: number[]) => {
        const circuit = genCircuit(g.nodes.length, g.edges, p, layers);
        const startBits = Array.from({ length: g.nodes.length }, () => (Math.random() < 0.5 ? 0 : 1) as 0 | 1);
        const results = runCircuit(startBits, circuit, numTrials);
        // Negate avCutSize because SPSA minimizes cost, but we want to maximize Cut Size
        return -avCutSize(results, g.edges);
    };

    // Run Loop
    for (let i = 0; i < maxIter; i++) {
        const { newParams, cost } = spsaStep(currentParams, i, objective);
        currentParams = newParams;
        history.push({ iter: i, cost: -cost }); // cost is negative cut size, so -cost is positive cut size
        
        if (i % 5 === 0) {
            setOptState({
                params: currentParams,
                iteration: i,
                bestCost: -cost,
                avgCost: -cost,
                bestSolution: [],
                history: [...history]
            });
            await new Promise(r => setTimeout(r, 0));
        }
    }

    paramsRef.current = currentParams;
    setOptState({
        params: currentParams,
        iteration: maxIter,
        bestCost: history[history.length-1].cost,
        avgCost: history[history.length-1].cost,
        bestSolution: [],
        history: history
    });
    setPhase('trained');
    
    const initialBits = Array.from({ length: numNodes }, () => (Math.random() < 0.5 ? 0 : 1) as 0 | 1);
    setCurrentBits(initialBits);
    if(graphRef.current) setCurrentCutSize(cutSize(initialBits, graphRef.current.edges));
  };

  // --- PHASE 2: Visualization (Replay) ---
  const startVisualization = () => {
      setPhase('playing');
      const g = graphRef.current;
      if (!g) return;

      const startBits = Array.from({ length: numNodes }, () => (Math.random() < 0.5 ? 0 : 1) as 0 | 1);
      setCurrentBits(startBits);
      setCurrentCutSize(cutSize(startBits, g.edges));
      setStepCount(0);

      const genCircuit = getCircuitGenerator(algoType);
      const circuit = genCircuit(g.nodes.length, g.edges, paramsRef.current, layers);
      inspectorGenRef.current = runCircuitStepByStep(startBits, circuit);

      playNextStep();
  };

  const playNextStep = () => {
      if (!inspectorGenRef.current) return;

      const { value, done } = inspectorGenRef.current.next();
      
      if (done) {
          setPhase('trained');
          setInspectorStep(null);
          setAnimationPhase('before');
          return;
      }

      // --- SEQUENCE LOGIC ---
      
      // 1. Show BEFORE state
      setInspectorStep(value);
      setAnimationPhase('before');
      setCurrentBits(value.bitsBefore); // Set UI to 'Before' state
      if(graphRef.current) setCurrentCutSize(cutSize(value.bitsBefore, graphRef.current.edges));
      
      setStepCount(prev => prev + 1);

      // 2. Wait 1.5s, then Show AFTER state
      playbackTimeoutRef.current = setTimeout(() => {
          setAnimationPhase('after');
          setCurrentBits(value.bitsAfter); // Update bits to 'After' state
          if(graphRef.current) setCurrentCutSize(cutSize(value.bitsAfter, graphRef.current.edges));
          
          // 3. Wait another 1.5s, then Next Step
          playbackTimeoutRef.current = setTimeout(playNextStep, 1500); 
      }, 1500);
  };

  useEffect(() => {
      return () => {
          if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      }
  }, []);

  const handleReset = () => {
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      setPhase('idle');
      initGraph();
  };


  // --- Drawing Logic ---
  const drawGraph = (g: GraphData, bits: number[], step: StepInfo | null, animPhase: 'before' | 'after') => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Grid
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1; ctx.beginPath();
      for(let x=0; x<canvas.width; x+=80) { ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); }
      for(let y=0; y<canvas.height; y+=80) { ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); }
      ctx.stroke();

      const activeEdge = step ? step.activeEdge : null;

      // Draw Edges
      g.edges.forEach(edge => {
          const n1 = g.nodes[edge.source];
          const n2 = g.nodes[edge.target];
          const bit1 = bits[edge.source];
          const bit2 = bits[edge.target];
          const isCut = (bit1 !== undefined && bit2 !== undefined) ? (bit1 !== bit2) : false;

          const isActive = activeEdge && 
                           ((activeEdge[0] === edge.source && activeEdge[1] === edge.target) || 
                            (activeEdge[0] === edge.target && activeEdge[1] === edge.source));

          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          
          if (isActive) {
              // ACTIVE OPERATION: Bright White/Pink
              ctx.lineWidth = 6;
              ctx.strokeStyle = '#fff';
              ctx.shadowColor = '#ec4899';
              ctx.shadowBlur = 20;
              ctx.setLineDash([]);
          } else if (isCut) {
              // CUT EDGE
              ctx.lineWidth = 3;
              ctx.strokeStyle = '#06b6d4'; // Cyan
              ctx.shadowColor = '#06b6d4';
              ctx.shadowBlur = 10;
              ctx.setLineDash([8, 6]); 
          } else {
               // NON-CUT
               ctx.lineWidth = 1;
               ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)'; 
               ctx.shadowBlur = 0;
               ctx.setLineDash([]);
          }
          ctx.stroke();
          ctx.shadowBlur = 0; ctx.setLineDash([]);
      });

      // Draw Nodes
      g.nodes.forEach((node, idx) => {
          const bit = bits[idx];
          const isActive = activeEdge && (activeEdge[0] === idx || activeEdge[1] === idx);
          
          // Check if this node changed state in this step
          let hasChanged = false;
          if (step && animPhase === 'after' && isActive) {
             const prevBit = step.bitsBefore[idx];
             if (prevBit !== bit) {
                 hasChanged = true;
             }
          }

          // Active Halo
          if (isActive) {
             ctx.beginPath();
             ctx.arc(node.x, node.y, NODE_RADIUS + 10, 0, 2 * Math.PI);
             ctx.fillStyle = 'rgba(236, 72, 153, 0.2)';
             ctx.fill();
          }

          // Changed Flash Halo
          if (hasChanged) {
             ctx.beginPath();
             ctx.arc(node.x, node.y, NODE_RADIUS + 20, 0, 2 * Math.PI);
             ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
             ctx.fill();
          }

          ctx.beginPath();
          const r = isActive ? NODE_RADIUS + 2 : NODE_RADIUS;
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          
          const grad = ctx.createRadialGradient(node.x, node.y, 2, node.x, node.y, r);
          
          // Color logic
          if (bit === 1) {
              grad.addColorStop(0, '#22d3ee'); 
              grad.addColorStop(1, '#0891b2');
          } else {
              grad.addColorStop(0, '#e879f9'); 
              grad.addColorStop(1, '#c026d3');
          }
          ctx.fillStyle = grad;
          ctx.fill();
          
          ctx.strokeStyle = hasChanged ? '#fff' : (isActive ? '#fce7f3' : '#0f172a');
          ctx.lineWidth = hasChanged ? 4 : (isActive ? 3 : 2);
          ctx.stroke();

          // Bit Value inside node
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(bit !== undefined ? bit.toString() : "?", node.x, node.y);
      });
  };

  useEffect(() => {
      if (graphRef.current) {
          drawGraph(graphRef.current, currentBits, inspectorStep, animationPhase);
      }
  }, [currentBits, inspectorStep, animationPhase]);

  return (
    <div className="relative w-full h-screen bg-slate-950 text-slate-200 overflow-hidden flex">
      
      {/* Canvas */}
      <div ref={containerRef} className="absolute inset-0 z-0 flex items-center justify-center">
         <canvas ref={canvasRef} width={canvasSize.w} height={canvasSize.h} className="block" />
      </div>

      {/* --- Matrix HUD Container (Fixed Layout & Spacing) --- */}
      {phase === 'playing' && inspectorStep && (
          <div className="absolute top-6 right-6 z-30 flex flex-col items-end gap-6 pointer-events-none">
              
               {/* 1. Cut Counter HUD */}
               <div className="pointer-events-auto bg-slate-900/90 backdrop-blur border border-cyan-500/30 rounded-xl p-4 shadow-[0_0_40px_rgba(6,182,212,0.15)] flex flex-col items-center min-w-[140px]">
                    <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-widest mb-1">
                         <Scissors size={14} /> Cut Size
                    </div>
                    <div className="text-4xl font-mono font-black text-white drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]">
                        {currentCutSize}
                    </div>
               </div>

              {/* 2. Main Matrix HUD */}
              <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md border border-pink-500/30 rounded-xl p-5 shadow-[0_0_40px_rgba(236,72,153,0.15)] w-[400px]">
                 <div className="flex justify-between items-center mb-4 border-b border-pink-500/20 pb-2">
                      <div className="flex items-center gap-2 text-pink-400 text-sm font-bold uppercase tracking-widest">
                         <Microscope size={16} /> Gate Operation
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                          Step {stepCount} / {totalSteps}
                      </div>
                  </div>

                  <div className="flex items-center justify-center gap-4">
                      {/* Input */}
                      <div className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${animationPhase === 'before' ? 'opacity-100 scale-105' : 'opacity-50'}`}>
                          <span className="text-[10px] text-slate-400 uppercase tracking-widest">In</span>
                          <div className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-mono font-bold bg-slate-800
                                ${inspectorStep.inputState.toString(2).padStart(2,'0') === '00' ? 'border-purple-500 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 
                                  inspectorStep.inputState.toString(2).padStart(2,'0') === '11' ? 'border-purple-500 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 
                                  'border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]'} 
                          `}>
                              {inspectorStep.inputState.toString(2).padStart(2,'0')}
                          </div>
                      </div>

                      <ArrowRight className="text-slate-600" />

                      {/* Matrix */}
                      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-800 rounded border border-slate-700">
                         {inspectorStep.matrix.flat().map((val, idx) => {
                             const r = Math.floor(idx / 4);
                             const c = idx % 4;
                             const isInputCol = c === inspectorStep.inputState;
                             const isOutputRow = r === inspectorStep.outputState;
                             const isActive = isInputCol && isOutputRow;
                             
                             return (
                                 <div key={idx} className={`w-7 h-7 flex items-center justify-center text-[8px] rounded-sm transition-all duration-500
                                     ${isActive && animationPhase === 'after' ? 'bg-pink-500 text-white font-bold scale-110 shadow-lg z-10 ring-2 ring-pink-300' : 
                                       (isInputCol && animationPhase === 'before') ? 'bg-purple-600/30 text-purple-200 ring-1 ring-purple-500/50' : 
                                       'bg-slate-900 text-slate-700'}
                                 `}>
                                     {val.toFixed(2)}
                                 </div>
                             )
                         })}
                      </div>

                       <ArrowRight className="text-slate-600" />

                      {/* Output */}
                       <div className={`flex flex-col items-center gap-1 transition-all duration-300 ${animationPhase === 'after' ? 'opacity-100 scale-105' : 'opacity-40 blur-[1px]'}`}>
                          <span className="text-[10px] text-slate-400 uppercase tracking-widest">Out</span>
                          <div className="w-12 h-12 rounded-lg bg-slate-800 border-2 border-slate-600 flex items-center justify-center text-xl font-mono font-bold text-white shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                              {inspectorStep.outputState.toString(2).padStart(2,'0')}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- Sidebar --- */}
      <aside className={`relative z-10 w-80 h-full bg-slate-900/95 backdrop-blur-md border-r border-slate-800 flex flex-col shadow-2xl transition-transform ${phase === 'playing' ? 'opacity-40 hover:opacity-100' : 'opacity-100'}`}>
          <div className="p-6 border-b border-slate-800">
             <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                 <Activity className="text-blue-400" /> PAOA <span className="text-blue-500 font-light">Vis</span>
             </h1>
          </div>

          <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
              {/* Configuration */}
              <div className={phase !== 'idle' ? 'opacity-50 pointer-events-none grayscale transition-all' : 'transition-all'}>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">
                      <Network size={14} /> 1. Configure Graph
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                      {['regular', 'erdos', 'complete'].map(t => (
                          <button 
                            key={t}
                            onClick={() => setGraphType(t as GraphType)}
                            className={`text-[10px] uppercase font-bold py-1 px-2 rounded border ${graphType === t ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'border-slate-700 text-slate-500 hover:border-slate-500'}`}
                          >
                              {t}
                          </button>
                      ))}
                  </div>
                  <RangeControl label="Nodes" value={numNodes} min={4} max={30} step={2} onChange={setNumNodes} />
                  {graphType === 'regular' && <RangeControl label="Degree" value={degree} min={2} max={6} onChange={setDegree} />}
                  {graphType === 'erdos' && <RangeControl label="Prob" value={prob} min={0.1} max={1.0} step={0.1} onChange={setProb} />}
              
                  <div className="h-px bg-slate-800 my-6"></div>

                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">
                      <Cpu size={14} /> 2. Configure Model
                  </div>
                   <div className="flex flex-col gap-2 mb-4">
                      {['reduced', 'minimum', 'standard'].map(t => (
                          <button 
                            key={t}
                            onClick={() => setAlgoType(t as AlgorithmType)}
                            className={`text-xs text-left px-3 py-2 rounded border transition-all ${algoType === t ? 'bg-purple-600/20 border-purple-500 text-purple-300' : 'border-slate-700 text-slate-500 hover:bg-slate-800'}`}
                          >
                              <div className="font-bold capitalize">{t} PAOA</div>
                              <div className="text-[10px] opacity-70">
                                  {t === 'minimum' ? '2 params/layer' : t === 'reduced' ? '1 param/edge' : '4 params/edge'}
                              </div>
                          </button>
                      ))}
                  </div>
                  <RangeControl label="Layers" value={layers} min={1} max={5} onChange={setLayers} />
                  <RangeControl label="Trials/Step" value={numTrials} min={10} max={100} step={10} onChange={setNumTrials} />
                  <RangeControl label="SPSA Iterations" value={maxIter} min={50} max={300} step={50} onChange={setMaxIter} />
              </div>

              {/* Ready State */}
              {(phase === 'trained' || phase === 'playing') && (
                  <div className="mt-6 bg-emerald-900/20 rounded-lg p-4 border border-emerald-500/30">
                      <div className="flex items-center gap-2 text-emerald-400 mb-2 font-bold text-sm">
                          <CheckCircle2 size={16} /> Model Optimized
                      </div>
                      <button 
                        onClick={startVisualization}
                        disabled={phase === 'playing'}
                        className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 font-bold transition-all
                            ${phase === 'playing' ? 'bg-slate-700 text-slate-500' : 'bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-900/20'}`}
                      >
                         {phase === 'playing' ? <><Loader2 className="animate-spin" size={14}/> Replaying...</> : <><Play size={14} fill="currentColor"/> Visualize Process</>}
                      </button>
                  </div>
              )}
          </div>

          <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex flex-col gap-3">
              {phase === 'idle' && (
                 <button 
                    onClick={runTraining}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg flex items-center justify-center gap-2 font-semibold transition-all shadow-lg shadow-blue-900/20"
                >
                    <Zap size={18} fill="currentColor" /> Train Model
                </button>
              )}
              
              <button onClick={handleReset} className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-lg border border-slate-700 flex justify-center gap-2 font-semibold">
                  <RotateCcw size={18} /> Reset
              </button>
          </div>
      </aside>

      {/* --- Footer Stats (Training History) --- */}
      {(phase !== 'idle') && (
        <div className="absolute bottom-6 right-6 w-96 pointer-events-none">
            <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-4 shadow-2xl">
                <div className="flex justify-between items-center mb-2">
                    <div className="text-xs font-bold text-slate-500 uppercase">Training Loss (SPSA)</div>
                    <div className="text-xs font-mono text-cyan-400">Best Cut: {optState?.bestCost.toFixed(2)}</div>
                </div>
                <div className="h-32 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={optState?.history || []}>
                            <defs>
                                <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
                            <YAxis hide domain={['auto', 'auto']} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
                                itemStyle={{ color: '#22d3ee' }}
                                labelFormatter={() => ''}
                                formatter={(val: number) => [val.toFixed(2), "Cut Size"]}
                            />
                            <Area type="monotone" dataKey="cost" stroke="#06b6d4" strokeWidth={2} fill="url(#colorCost)" isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}