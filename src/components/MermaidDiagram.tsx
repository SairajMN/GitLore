'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Initialize mermaid with a dark theme
mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
        primaryColor: '#6366f1',
        primaryTextColor: '#f1f5f9',
        primaryBorderColor: '#818cf8',
        lineColor: '#94a3b8',
        secondaryColor: '#1e293b',
        tertiaryColor: '#0f172a',
        background: '#0f172a',
        mainBkg: '#1e293b',
        nodeBorder: '#818cf8',
        clusterBkg: '#1e293b',
        titleColor: '#f1f5f9',
        edgeLabelBackground: '#1e293b',
    },
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
    sequence: { useMaxWidth: true },
    themeCSS: `
    .node rect { fill: #1e293b; stroke: #818cf8; }
    .node text { fill: #e2e8f0; font-size: 13px; }
    .edgePath .path { stroke: #94a3b8; }
    .edgeLabel { background-color: #1e293b; color: #e2e8f0; font-size: 11px; }
    .cluster rect { fill: #1e293b; stroke: #475569; }
    .cluster text { fill: #94a3b8; }
    .flowchart-link { stroke: #94a3b8; }
    marker#arrowhead path { fill: #94a3b8; }
  `,
});

interface MermaidDiagramProps {
    code: string;
    id?: string;
}

let diagramCounter = 0;

export default function MermaidDiagram({ code, id }: MermaidDiagramProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [renderId] = useState(() => `mermaid-${++diagramCounter}-${Date.now()}`);

    useEffect(() => {
        let cancelled = false;

        async function render() {
            try {
                // Clean up the mermaid code
                let cleanCode = code
                    .replace(/^```mermaid\s*/i, '')
                    .replace(/```\s*$/, '')
                    .trim();

                const { svg: rendered } = await mermaid.render(renderId, cleanCode);
                if (!cancelled) {
                    setSvg(rendered);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('Mermaid render error:', err);
                    setError(err instanceof Error ? err.message : 'Failed to render diagram');
                }
            }
        }

        render();
        return () => { cancelled = true; };
    }, [code, renderId]);

    if (error) {
        return (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 my-3">
                <p className="text-red-400 text-xs mb-1">Diagram rendering failed</p>
                <pre className="text-red-300 text-xs overflow-x-auto whitespace-pre-wrap">{error}</pre>
                <pre className="text-gray-400 text-xs mt-2 overflow-x-auto whitespace-pre-wrap">{code}</pre>
            </div>
        );
    }

    return (
        <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4 my-3 overflow-x-auto">
            {svg ? (
                <div
                    ref={containerRef}
                    className="[&_svg]:max-w-full [&_svg]:h-auto"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            ) : (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--primary)]" />
                </div>
            )}
        </div>
    );
}