interface SkeletonProps {
  className?: string;
}

export default function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="glass rounded-lg p-5 space-y-3">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-44" />
    </div>
  );
}

export function SkeletonChat() {
  return (
    <div className="space-y-6 px-4 py-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className={`flex gap-3 ${i % 2 === 0 ? "justify-end" : ""}`}>
          {i % 2 !== 0 && <Skeleton className="h-9 w-9 rounded-xl shrink-0" />}
          <Skeleton className={`rounded-lg ${i % 2 === 0 ? "h-12 w-48" : "h-24 w-96"}`} />
        </div>
      ))}
    </div>
  );
}
