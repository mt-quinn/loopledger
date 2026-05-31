"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import { createPortal } from "react-dom";

const PHONE_QUERY = "(max-width: 640px)";

function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isPhone;
}

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

type PanelProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  id?: string;
  anchorRef?: RefObject<HTMLElement | null>;
  width?: number;
  className?: string;
  children: ReactNode;
};

const VIEWPORT_MARGIN = 12;

/**
 * Adaptive surface: a bottom sheet on phones and an anchored popover on larger
 * screens. Positions itself against `anchorRef` choosing the side with the most
 * available space, so it works for both a bottom dock and a side rail.
 */
export default function Panel({
  open,
  onClose,
  title,
  id,
  anchorRef,
  width = 320,
  className,
  children
}: PanelProps) {
  const isPhone = useIsPhone();
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const computePosition = useCallback(() => {
    if (isPhone) {
      return;
    }
    const anchor = anchorRef?.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const desiredWidth = Math.min(width, vw - VIEWPORT_MARGIN * 2);

    if (!anchor) {
      setPosition({
        top: VIEWPORT_MARGIN,
        left: Math.max(VIEWPORT_MARGIN, vw - desiredWidth - VIEWPORT_MARGIN),
        width: desiredWidth,
        maxHeight: vh - VIEWPORT_MARGIN * 2
      });
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const spaceRight = vw - rect.right;
    const spaceLeft = rect.left;
    const spaceAbove = rect.top;
    const spaceBelow = vh - rect.bottom;
    const gap = 10;
    // Height of the panel as currently rendered, so a tall panel can be
    // centered against its anchor rather than capped at the anchor's edge.
    const measured = panelRef.current?.getBoundingClientRect().height ?? 0;

    // Prefer horizontal placement next to a rail, vertical next to a bar.
    const horizontal = Math.max(spaceLeft, spaceRight);
    const vertical = Math.max(spaceAbove, spaceBelow);

    let top: number;
    let left: number;
    let maxHeight: number;

    if (horizontal >= vertical && horizontal >= desiredWidth + gap) {
      // Beside a rail: center vertically on the anchor and let the panel grow
      // both above and below the button, using the full viewport height.
      left = spaceRight >= spaceLeft ? rect.right + gap : rect.left - gap - desiredWidth;
      maxHeight = vh - VIEWPORT_MARGIN * 2;
      const panelHeight = Math.min(measured || maxHeight, maxHeight);
      const anchorCenter = rect.top + rect.height / 2;
      top = Math.min(
        Math.max(VIEWPORT_MARGIN, anchorCenter - panelHeight / 2),
        vh - VIEWPORT_MARGIN - panelHeight
      );
    } else if (spaceAbove >= spaceBelow) {
      left = rect.left;
      maxHeight = rect.top - gap - VIEWPORT_MARGIN;
      top = Math.max(VIEWPORT_MARGIN, rect.top - gap - maxHeight);
    } else {
      left = rect.left;
      top = rect.bottom + gap;
      maxHeight = vh - top - VIEWPORT_MARGIN;
    }

    left = Math.min(Math.max(VIEWPORT_MARGIN, left), vw - desiredWidth - VIEWPORT_MARGIN);

    setPosition({ top, left, width: desiredWidth, maxHeight: Math.max(160, maxHeight) });
  }, [anchorRef, isPhone, width]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    computePosition();
  }, [open, computePosition]);

  useEffect(() => {
    if (!open || isPhone) {
      return;
    }
    const handler = () => computePosition();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open, isPhone, computePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) {
    return null;
  }

  const popoverStyle = !isPhone && position
    ? { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }
    : undefined;

  return createPortal(
    <div className={`panel-root ${isPhone ? "panel-root-sheet" : "panel-root-popover"}`}>
      <div
        className={isPhone ? "panel-scrim panel-scrim-dim" : "panel-scrim"}
        onPointerDown={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal={isPhone ? "true" : undefined}
        aria-label={title}
        className={`panel ${isPhone ? "panel-sheet" : "panel-popover"} ${className ?? ""}`}
        style={popoverStyle}
      >
        {isPhone ? <div className="panel-grabber" aria-hidden="true" /> : null}
        {title ? (
          <div className="panel-head">
            <h2 className="panel-title">{title}</h2>
            <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        ) : null}
        <div className="panel-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
