import type { RefObject } from "react";
import { Card, Label } from "@/components/ui";

/** Presentational live-browser panel; the recording logic stays in the page. */
export function LiveView({
  recording,
  frame,
  startUrl,
  imgRef,
  onClick,
  onWheel,
  onKey,
}: {
  recording: boolean;
  frame: string | null;
  startUrl?: string;
  imgRef: RefObject<HTMLImageElement | null>;
  onClick: (e: React.MouseEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onKey: (e: React.KeyboardEvent) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <Label>Live browser</Label>
        <span className="mono truncate text-xs text-ink-3">{startUrl}</span>
      </div>
      <div
        className="grid aspect-[16/10] place-items-center bg-bg outline-none"
        tabIndex={0}
        onKeyDown={onKey}
      >
        {recording && frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${frame}`}
            alt="live browser"
            className="h-full w-full cursor-crosshair object-contain"
            onClick={onClick}
            onWheel={onWheel}
            draggable={false}
          />
        ) : (
          <span className="text-sm text-ink-3">
            {recording
              ? "Connecting to the live browser…"
              : "The live browser will appear here once you start."}
          </span>
        )}
      </div>
      {recording && (
        <div className="border-t border-border px-4 py-2 text-xs text-ink-3">
          Click in the view to interact. Click a field first, then type.
        </div>
      )}
    </Card>
  );
}
