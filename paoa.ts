import { Edge } from "./graph-utils";

export type AlgorithmType = 'reduced' | 'minimum' | 'standard';

export interface OptimizationState {
    params: number[];
    iteration: number;
    bestCost: number;
    avgCost: number;
    bestSolution: number[];
    history: { iter: number; cost: number }[];
}

export function cutSize(x: number[], edges: Edge[]): number {
  let cut = 0;
  for (const edge of edges) {
    if (x[edge.source] !== x[edge.target]) {
      cut += 1; // FIX: Return positive cut size
    }
  }
  return cut;
}

export function avCutSize(solutions: number[][], edges: Edge[]): number {
  let total = 0;
  for (const sol of solutions) {
    total += cutSize(sol, edges);
  }
  return total / solutions.length;
}

export interface CircuitGate {
  bitIndices: [number, number];
  matrix: number[][]; // 4x4 matrix
}

// --- Circuit Generators ---

export function reducedPaoaCircuit(numNodes: number, edges: Edge[], params: number[], layers: number): CircuitGate[] {
  const circuit: CircuitGate[] = [];
  let k = 0;
  for (let l = 0; l < layers; l++) {
    for (const edge of edges) {
      const p = params[k] || 0.5; // Safety fallback
      const matrix = [
        [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]
      ];
      // Reduced PAOA Matrix Construction
      matrix[1][0] = p; matrix[2][3] = p;
      matrix[2][0] = 1 - p; matrix[1][3] = 1 - p;
      matrix[1][1] = p; matrix[2][2] = p;
      matrix[1][2] = 1 - p; matrix[2][1] = 1 - p;

      circuit.push({ bitIndices: [edge.source, edge.target], matrix });
      k++;
    }
  }
  return circuit;
}

export function minimumPaoaCircuit(numNodes: number, edges: Edge[], params: number[], layers: number): CircuitGate[] {
    const circuit: CircuitGate[] = [];
    let k = 0; // Index in circuit list
    let m = 0; // Index in params (only increments per layer)
  
    for (let l = 0; l < layers; l++) {
        const p1 = params[m] || 0.5;
        const p2 = params[m+1] || 0.5;

        for (const edge of edges) {
            const matrix = [
                [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]
            ];
            // Minimum PAOA: Shared params p1, p2 for all edges in layer
            matrix[1][0] = p1; matrix[2][3] = p1;
            matrix[2][0] = 1 - p1; matrix[1][3] = 1 - p1;
            
            matrix[1][1] = p2; matrix[2][2] = p2;
            matrix[1][2] = 1 - p2; matrix[2][1] = 1 - p2;

            circuit.push({ bitIndices: [edge.source, edge.target], matrix });
            k++;
        }
        m += 2;
    }
    return circuit;
}

export function standardPaoaCircuit(numNodes: number, edges: Edge[], params: number[], layers: number): CircuitGate[] {
    const circuit: CircuitGate[] = [];
    let k = 0; // params index

    for (let l = 0; l < layers; l++) {
        for (const edge of edges) {
            const matrix = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
            for(let col=0; col<4; col++) {
                const val = params[k + col] || 0.5;
                matrix[1][col] = val;
                matrix[2][col] = 1 - val;
            }
            circuit.push({ bitIndices: [edge.source, edge.target], matrix });
            k += 4;
        }
    }
    return circuit;
}

export function getCircuitGenerator(type: AlgorithmType) {
    switch(type) {
        case 'minimum': return minimumPaoaCircuit;
        case 'standard': return standardPaoaCircuit;
        case 'reduced': default: return reducedPaoaCircuit;
    }
}

// --- Execution Logic ---

export function runCircuit(startingBits: number[], circuit: CircuitGate[], numTrials: number): number[][] {
  const results: number[][] = [];
  for (let t = 0; t < numTrials; t++) {
    const bits = [...startingBits];
    for (const gate of circuit) {
      applyGate(bits, gate);
    }
    results.push(bits);
  }
  return results;
}

// Mutates bits
function applyGate(bits: number[], gate: CircuitGate): void {
      const [i, j] = gate.bitIndices;
      const bitI = bits[i];
      const bitJ = bits[j];
      const currentIndex = bitI * 2 + bitJ;

      // Column of matrix
      const probs = [
        gate.matrix[0][currentIndex],
        gate.matrix[1][currentIndex],
        gate.matrix[2][currentIndex],
        gate.matrix[3][currentIndex],
      ];

      const r = Math.random();
      let cumulative = 0;
      let sampledIndex = 3; 
      for (let k = 0; k < 4; k++) {
        cumulative += probs[k];
        if (r <= cumulative) {
          sampledIndex = k;
          break;
        }
      }

      bits[i] = Math.floor(sampledIndex / 2) % 2;
      bits[j] = sampledIndex % 2;
}

// --- Step-by-Step Generator for Visualization ---

export interface StepInfo {
    activeEdge: [number, number];
    matrix: number[][];
    inputState: number; // 0-3
    outputState: number; // 0-3
    probs: number[]; // The column probabilities
    bitsBefore: number[]; // ADDED: Capture state before mutation
    bitsAfter: number[];
}

export function* runCircuitStepByStep(startingBits: number[], circuit: CircuitGate[]): Generator<StepInfo> {
    const bits = [...startingBits];
    
    for (const gate of circuit) {
        const bitsBefore = [...bits]; // Capture Before
        const [i, j] = gate.bitIndices;
        const bitI = bits[i];
        const bitJ = bits[j];
        const inputState = bitI * 2 + bitJ;

        const probs = [
            gate.matrix[0][inputState],
            gate.matrix[1][inputState],
            gate.matrix[2][inputState],
            gate.matrix[3][inputState],
        ];

        const r = Math.random();
        let cumulative = 0;
        let outputState = 3;
        for (let k = 0; k < 4; k++) {
            cumulative += probs[k];
            if (r <= cumulative) {
                outputState = k;
                break;
            }
        }

        const nextBits = [...bits];
        nextBits[i] = Math.floor(outputState / 2) % 2;
        nextBits[j] = outputState % 2;
        
        // Update local state for next gate
        bits[i] = nextBits[i];
        bits[j] = nextBits[j];

        yield {
            activeEdge: gate.bitIndices,
            matrix: gate.matrix,
            inputState,
            outputState,
            probs,
            bitsBefore, // Return both states
            bitsAfter: bits
        };
    }
}

// --- Optimizer Utils ---

export function getRandomParams(type: AlgorithmType, layers: number, numEdges: number): number[] {
    let count = 0;
    if (type === 'reduced') count = layers * numEdges;
    else if (type === 'minimum') count = 2 * layers;
    else if (type === 'standard') count = 4 * layers * numEdges;
    
    return Array.from({ length: count }, () => Math.random());
}

export function spsaStep(
  currentParams: number[],
  iteration: number,
  objectiveFunction: (p: number[]) => number,
  a = 0.1, c = 0.1, alpha = 0.602, gamma = 0.101, A = 10
): { newParams: number[]; cost: number } {
  const k = iteration;
  const ak = a / Math.pow(k + 1 + A, alpha);
  const ck = c / Math.pow(k + 1, gamma);
  const delta = currentParams.map(() => (Math.random() < 0.5 ? 1 : -1));

  const thetaPlus = currentParams.map((p, i) => Math.max(0, Math.min(1, p + ck * delta[i])));
  const costPlus = objectiveFunction(thetaPlus);

  const thetaMinus = currentParams.map((p, i) => Math.max(0, Math.min(1, p - ck * delta[i])));
  const costMinus = objectiveFunction(thetaMinus);

  const gh = (costPlus - costMinus) / (2 * ck);
  
  const newParams = currentParams.map((p, i) => Math.max(0, Math.min(1, p - ak * gh * delta[i])));
  const currentCost = objectiveFunction(newParams);

  return { newParams, cost: currentCost };
}