export interface Node {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean; // New: Allow locking nodes
}

export interface Edge {
  source: number; // Node ID
  target: number; // Node ID
}

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

// --- Generators ---

export function generateCompleteGraph(n: number): GraphData {
    const edges: Edge[] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            edges.push({ source: i, target: j });
        }
    }
    return initNodes(n, edges);
}

export function generateErdosRenyi(n: number, p: number): GraphData {
    const edges: Edge[] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (Math.random() < p) {
                edges.push({ source: i, target: j });
            }
        }
    }
    return initNodes(n, edges);
}

export function generateRandomRegularGraph(n: number, d: number): GraphData {
  if (n * d % 2 !== 0) throw new Error("n * d must be even");
  if (d >= n) throw new Error("Degree must be less than n");

  let attempts = 0;
  while (attempts < 100) {
    attempts++;
    try {
      const edges = tryGenerateRegularEdges(n, d);
      return initNodes(n, edges);
    } catch (e) { continue; }
  }
  
  // Fallback: Cycle graph
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({ source: i, target: (i + 1) % n });
    if(d > 2) edges.push({ source: i, target: (i + 2) % n });
  }
  return initNodes(n, edges);
}

// Helper to init nodes with random positions (scattered)
function initNodes(n: number, edges: Edge[]): GraphData {
    // Initial circle layout is often better than random for stability
    const nodes: Node[] = Array.from({ length: n }, (_, i) => ({
        id: i,
        x: 400 + 300 * Math.cos(2 * Math.PI * i / n), // Wider start
        y: 300 + 300 * Math.sin(2 * Math.PI * i / n),
        vx: 0,
        vy: 0,
        fixed: false
    }));
    return { nodes, edges };
}

function tryGenerateRegularEdges(n: number, d: number): Edge[] {
  const points: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) points.push(i);
  }
  // Fisher-Yates shuffle
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();
  for (let i = 0; i < n * d; i += 2) {
    const u = points[i];
    const v = points[i + 1];
    if (u === v) throw new Error("Self-loop");
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (edgeSet.has(key)) throw new Error("Duplicate edge");
    edgeSet.add(key);
    edges.push({ source: u, target: v });
  }
  return edges;
}

// --- Layout ---

// Pre-calculate layout synchronously to avoid "ghostly flickering"
export function precalculateLayout(graph: GraphData, width: number, height: number, iterations = 400) {
    // Warmup with high temperature
    for(let i=0; i<iterations; i++) {
        // High alpha for start, cooling down
        const alpha = 1 - (i / iterations);
        stepForceLayout(graph, width, height, alpha);
    }
}

// Single step of force layout
export function stepForceLayout(graph: GraphData, width: number, height: number, alpha: number) {
  if (alpha <= 0.005) return; // Stop if cooled down

  // SIGNIFICANTLY INCREASED K to spread nodes out to full screen
  // sqrt(Area / N) is standard, we multiply by 2.5 to make it sparse
  const k = Math.sqrt((width * height) / (graph.nodes.length + 1)) * 2.5; 
  
  const repulsion = k * k * 2.0; // Stronger repulsion
  const centerForce = 0.01 * alpha; // Weak center force, just to keep them from flying off screen

  // Initialize forces
  const forces = graph.nodes.map(() => ({ fx: 0, fy: 0 }));

  // Repulsion
  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const n1 = graph.nodes[i];
      const n2 = graph.nodes[j];
      const dx = n1.x - n2.x;
      const dy = n1.y - n2.y;
      const d2 = dx * dx + dy * dy || 0.1;
      const dist = Math.sqrt(d2);
      
      const f = (repulsion / d2) * alpha;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;

      forces[i].fx += fx;
      forces[i].fy += fy;
      forces[j].fx -= fx;
      forces[j].fy -= fy;
    }
  }

  // Attraction
  for (const edge of graph.edges) {
    const idx1 = edge.source;
    const idx2 = edge.target;
    const n1 = graph.nodes[idx1];
    const n2 = graph.nodes[idx2];

    const dx = n1.x - n2.x;
    const dy = n1.y - n2.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;

    // Hooke's Law: f = k * x. We use a softer spring to allow stretching
    const f = ((dist * dist) / k) * alpha * 0.5; 
    const fx = (dx / dist) * f;
    const fy = (dy / dist) * f;

    forces[idx1].fx -= fx;
    forces[idx1].fy -= fy;
    forces[idx2].fx += fx;
    forces[idx2].fy += fy;
  }

  // Update positions
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    if (node.fixed) continue;

    // Center gravity
    forces[i].fx += (cx - node.x) * centerForce;
    forces[i].fy += (cy - node.y) * centerForce;

    // Apply force as displacement
    node.x += forces[i].fx;
    node.y += forces[i].fy;

    // Bounds (Keep padding small to use edges of screen)
    const padding = 40;
    node.x = Math.max(padding, Math.min(width - padding, node.x));
    node.y = Math.max(padding, Math.min(height - padding, node.y));
  }
}