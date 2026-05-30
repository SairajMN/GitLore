'use client';

interface ConfidenceBadgeProps {
  confidence: number;
  compact?: boolean;
}

export default function ConfidenceBadge({ confidence, compact }: ConfidenceBadgeProps) {
  const getLevel = (c: number) => {
    if (c >= 0.7) return { label: 'High', class: 'confidence-high' };
    if (c >= 0.4) return { label: 'Medium', class: 'confidence-medium' };
    return { label: 'Low', class: 'confidence-low' };
  };

  const { label, class: colorClass } = getLevel(confidence);

  return (
    <span className={`font-medium ${colorClass} ${compact ? 'text-xs' : 'text-sm'}`}>
      {label} ({Math.round(confidence * 100)}%)
    </span>
  );
}
