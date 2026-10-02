import { useMemo } from 'react';
import EmptyState from '../common/EmptyState';

const TYPE_COLORS = {
  PAPER: '#60a5fa',
  IMPLEMENTATION: '#34d399',
  DATASET: '#fbbf24',
  BENCHMARK: '#a855f7',
  PROJECT: '#94a3b8',
  RESOURCE: '#f472b6',
};

function layoutNodes(relationships, maxNodes = 16) {
  const nodeMap = new Map();
  const edges = [];

  const visible = relationships.slice(0, maxNodes);

  visible.forEach((rel) => {
    const srcTitle = rel.paperTitle || rel.sourceArtifact?.title || 'Source';
    const tgtTitle = rel.repoTitle || rel.targetArtifact?.title || 'Target';
    const srcType = rel.sourceArtifact?.type || 'PAPER';
    const tgtType = rel.targetArtifact?.type || 'IMPLEMENTATION';

    if (!nodeMap.has(srcTitle)) {
      nodeMap.set(srcTitle, { id: srcTitle, label: srcTitle, type: srcType, connections: 0 });
    }
    if (!nodeMap.has(tgtTitle)) {
      nodeMap.set(tgtTitle, { id: tgtTitle, label: tgtTitle, type: tgtType, connections: 0 });
    }
    nodeMap.get(srcTitle).connections++;
    nodeMap.get(tgtTitle).connections++;
    edges.push({
      source: srcTitle,
      target: tgtTitle,
      type: rel.relationshipType || 'IMPLEMENTED_BY',
      confidence: rel.confidence || 0,
      onSelect: rel.onSelect,
      rel,
    });
  });

  const nodes = Array.from(nodeMap.values());
  return { nodes, edges };
}

function positionNodes(nodes, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const count = nodes.length;

  if (count === 0) return [];
  if (count === 1) return [{ ...nodes[0], x: cx, y: cy }];

  // Separate into source (left) and target (right) columns
  const sources = [];
  const targets = [];
  const placed = new Set();

  // First pass: categorize by connection pattern
  nodes.forEach((n) => {
    if (n.type === 'PAPER' || n.type === 'DATASET') {
      sources.push(n);
      placed.add(n.id);
    } else if (!placed.has(n.id)) {
      targets.push(n);
      placed.add(n.id);
    }
  });

  const positioned = [];
  const leftX = width * 0.22;
  const rightX = width * 0.78;

  sources.forEach((node, i) => {
    const spacing = Math.min(60, (height - 80) / Math.max(sources.length - 1, 1));
    const startY = cy - ((sources.length - 1) * spacing) / 2;
    positioned.push({ ...node, x: leftX, y: startY + i * spacing });
  });

  targets.forEach((node, i) => {
    const spacing = Math.min(60, (height - 80) / Math.max(targets.length - 1, 1));
    const startY = cy - ((targets.length - 1) * spacing) / 2;
    positioned.push({ ...node, x: rightX, y: startY + i * spacing });
  });

  return positioned;
}

export default function RelationshipGraph({ relationships = [] }) {
  const width = 900;
  const height = 380;

  const { nodes, edges } = useMemo(() => layoutNodes(relationships), [relationships]);
  const positioned = useMemo(() => positionNodes(nodes, width, height), [nodes]);
  const nodePositions = useMemo(() => {
    const map = new Map();
    positioned.forEach((n) => map.set(n.id, n));
    return map;
  }, [positioned]);

  if (!relationships.length) {
    return (
      <EmptyState
        title="No relationships yet"
        description="Relationships will appear here as ReTrace establishes candidate links between research artifacts."
        icon="⬡"
      />
    );
  }

  return (
    <div className="graph-container">
      <div className="graph-toolbar">
        <div className="graph-legend">
          {Object.entries(TYPE_COLORS).slice(0, 4).map(([type, color]) => (
            <div key={type} className="graph-legend-item">
              <div className="graph-legend-dot" style={{ background: color }} />
              <span>{type}</span>
            </div>
          ))}
        </div>
        <div className="section-meta">{edges.length} edge{edges.length !== 1 ? 's' : ''} · {nodes.length} node{nodes.length !== 1 ? 's' : ''}</div>
      </div>

      <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(34,211,238,0.5)" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const src = nodePositions.get(edge.source);
          const tgt = nodePositions.get(edge.target);
          if (!src || !tgt) return null;

          const opacity = 0.2 + edge.confidence * 0.6;
          return (
            <g key={`edge-${i}`}>
              <line
                x1={src.x} y1={src.y}
                x2={tgt.x} y2={tgt.y}
                stroke={`rgba(34, 211, 238, ${opacity})`}
                strokeWidth={1 + edge.confidence * 2}
                markerEnd="url(#arrowhead)"
              />
              <text
                x={(src.x + tgt.x) / 2}
                y={(src.y + tgt.y) / 2 - 8}
                textAnchor="middle"
                fill="rgba(148,163,184,0.5)"
                fontSize="8"
                fontFamily="'JetBrains Mono', monospace"
              >
                {edge.type.replace(/_/g, ' ')} · {edge.confidence.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {positioned.map((node) => {
          const color = TYPE_COLORS[node.type] || '#94a3b8';
          const r = 6 + Math.min(node.connections * 2, 8);
          return (
            <g key={node.id} style={{ cursor: 'pointer' }}>
              <circle cx={node.x} cy={node.y} r={r + 4} fill={`${color}10`} stroke={color} strokeWidth={1} strokeOpacity={0.3} />
              <circle cx={node.x} cy={node.y} r={r} fill={color} fillOpacity={0.8} />
              <text
                x={node.x}
                y={node.y + r + 14}
                textAnchor="middle"
                fill="#8896a8"
                fontSize="9"
                fontFamily="'JetBrains Mono', monospace"
              >
                {node.label.length > 28 ? node.label.slice(0, 28) + '…' : node.label}
              </text>
              <text
                x={node.x}
                y={node.y - r - 6}
                textAnchor="middle"
                fill={color}
                fontSize="8"
                fontFamily="'JetBrains Mono', monospace"
                fontWeight="600"
                letterSpacing="0.08em"
              >
                {node.type}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
