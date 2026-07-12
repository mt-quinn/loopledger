"use client";

import { useEffect, useRef, useState, type Ref, type RefObject } from "react";

type ViewerMode = "pan" | "highlight";

type DockButtonProps = {
  glyph: string;
  label: string;
  active?: boolean;
  secondary?: boolean;
  value?: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  ariaExpanded?: boolean;
  disabled?: boolean;
};

function DockButton({
  glyph,
  label,
  active,
  secondary,
  value,
  onClick,
  buttonRef,
  ariaExpanded,
  disabled
}: DockButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`dock-btn${active ? " active" : ""}${secondary ? " dock-secondary" : ""}`}
      onClick={onClick}
      aria-pressed={active ? true : undefined}
      aria-expanded={ariaExpanded}
      aria-label={label}
      disabled={disabled}
    >
      <span className="dock-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="dock-label">{label}</span>
      {value ? <span className="dock-value">{value}</span> : null}
    </button>
  );
}

export type SaveStatus = "saved" | "saving" | "error" | "offline";

const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved ✓",
  saving: "Saving…",
  error: "Not saved",
  offline: "Offline"
};

/**
 * Error and offline states stay pinned; "Saved ✓" only flashes briefly after a
 * save completes so the topbar stays quiet during normal work.
 */
function useTransientSaveChip(saveStatus: SaveStatus): boolean {
  const [visible, setVisible] = useState(false);
  const previousRef = useRef<SaveStatus>(saveStatus);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = saveStatus;

    if (saveStatus !== "saved") {
      setVisible(true);
      return;
    }
    if (previous === "saving" || previous === "error" || previous === "offline") {
      setVisible(true);
      const timeoutId = window.setTimeout(() => setVisible(false), 1600);
      return () => window.clearTimeout(timeoutId);
    }
    setVisible(false);
  }, [saveStatus]);

  return visible;
}

export type EditorChromeProps = {
  toolbarRef: Ref<HTMLElement>;
  projectName: string;
  sourceFileName: string;
  saveStatus: SaveStatus;
  activeToolGlyph: string;
  activeToolLabel: string;
  activeToolColor: string;
  onBack: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  mode: ViewerMode;
  onSetMode: (mode: ViewerMode) => void;
  isExporting: boolean;
  onExport: () => void;
  zoomPercent: number;
  isToolsOpen: boolean;
  onToggleTools: () => void;
  toolsButtonRef: RefObject<HTMLButtonElement>;
  isCounterMenuOpen: boolean;
  onToggleCounterMenu: () => void;
  counterButtonRef: RefObject<HTMLButtonElement>;
  isZoomOpen: boolean;
  onToggleZoom: () => void;
  zoomButtonRef: RefObject<HTMLButtonElement>;
  isIndexOpen: boolean;
  onToggleIndex: () => void;
  indexButtonRef: RefObject<HTMLButtonElement>;
  isCalcOpen: boolean;
  onToggleCalc: () => void;
  calcButtonRef: RefObject<HTMLButtonElement>;
  isReferenceActive: boolean;
  onReferenceClick: () => void;
  referenceButtonRef: RefObject<HTMLButtonElement>;
  isMoreOpen: boolean;
  onToggleMore: () => void;
  moreButtonRef: RefObject<HTMLButtonElement>;
};

export default function EditorChrome({
  toolbarRef,
  projectName,
  sourceFileName,
  saveStatus,
  activeToolGlyph,
  activeToolLabel,
  activeToolColor,
  onBack,
  theme,
  onToggleTheme,
  mode,
  onSetMode,
  isExporting,
  onExport,
  zoomPercent,
  isToolsOpen,
  onToggleTools,
  toolsButtonRef,
  isCounterMenuOpen,
  onToggleCounterMenu,
  counterButtonRef,
  isZoomOpen,
  onToggleZoom,
  zoomButtonRef,
  isIndexOpen,
  onToggleIndex,
  indexButtonRef,
  isCalcOpen,
  onToggleCalc,
  calcButtonRef,
  isReferenceActive,
  onReferenceClick,
  referenceButtonRef,
  isMoreOpen,
  onToggleMore,
  moreButtonRef
}: EditorChromeProps) {
  const isMarkup = mode === "highlight";
  const chipVisible = useTransientSaveChip(saveStatus);

  return (
    <>
      <header ref={toolbarRef} className="editor-topbar">
        <button type="button" className="topbar-back" onClick={onBack} aria-label="Back to Projects">
          <span className="topbar-back-arrow" aria-hidden="true">
            ←
          </span>
          <span className="topbar-back-label">Projects</span>
        </button>

        <div className="topbar-title">
          <span className="topbar-name" title={projectName}>
            {projectName}
          </span>
          <span className="topbar-file" title={sourceFileName}>
            {sourceFileName}
          </span>
        </div>

        <div className="topbar-actions">
          <span
            className={`topbar-save-status is-${saveStatus}${chipVisible ? "" : " is-hidden"}`}
            role="status"
            title={
              saveStatus === "offline"
                ? "You're offline. Changes are stored on this device and will sync when you're back online."
                : saveStatus === "error"
                  ? "Your latest changes could not be saved to your account."
                  : undefined
            }
          >
            {SAVE_STATUS_TEXT[saveStatus]}
          </span>
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          </button>
        </div>
      </header>

      <nav className="editor-dock" aria-label="Pattern tools">
        <div className="dock-mode" role="group" aria-label="Reading mode">
          <button
            type="button"
            className={`dock-mode-btn${!isMarkup ? " active" : ""}`}
            onClick={() => onSetMode("pan")}
            aria-pressed={!isMarkup}
            aria-label="Pan mode"
          >
            <span className="dock-glyph" aria-hidden="true">
              ❏
            </span>
            <span className="dock-mode-label">Pan</span>
          </button>
          <button
            type="button"
            className={`dock-mode-btn${isMarkup ? " active" : ""}`}
            onClick={() => onSetMode("highlight")}
            aria-pressed={isMarkup}
            aria-label="Mark up mode"
          >
            <span className="dock-glyph" aria-hidden="true">
              ✎
            </span>
            <span className="dock-mode-label">Mark up</span>
          </button>
        </div>

        <div className="dock-items">
          <button
            ref={toolsButtonRef}
            type="button"
            className={`dock-btn${isToolsOpen ? " active" : ""}`}
            onClick={onToggleTools}
            aria-expanded={isToolsOpen}
            aria-label={isMarkup ? `Tools — ${activeToolLabel} selected` : "Tools"}
          >
            <span className="dock-glyph dock-tool-glyph" aria-hidden="true">
              {isMarkup ? activeToolGlyph : "🖌"}
              {isMarkup ? <span className="dock-tool-color" style={{ background: activeToolColor }} /> : null}
            </span>
            <span className="dock-label">{isMarkup ? activeToolLabel : "Tools"}</span>
          </button>
          <DockButton
            glyph="＋"
            label="Counter"
            active={isCounterMenuOpen}
            onClick={onToggleCounterMenu}
            buttonRef={counterButtonRef}
            ariaExpanded={isCounterMenuOpen}
          />
          <DockButton
            glyph="⊕"
            label="View"
            value={`${zoomPercent}%`}
            active={isZoomOpen}
            onClick={onToggleZoom}
            buttonRef={zoomButtonRef}
            ariaExpanded={isZoomOpen}
          />
          <DockButton
            glyph="🔖"
            label="Bookmarks"
            secondary
            active={isIndexOpen}
            onClick={onToggleIndex}
            buttonRef={indexButtonRef}
            ariaExpanded={isIndexOpen}
          />
          <DockButton
            glyph="🧮"
            label="Calc"
            secondary
            active={isCalcOpen}
            onClick={onToggleCalc}
            buttonRef={calcButtonRef}
            ariaExpanded={isCalcOpen}
          />
          <DockButton
            glyph="❒"
            label="Reference"
            secondary
            active={isReferenceActive}
            onClick={onReferenceClick}
            buttonRef={referenceButtonRef}
          />
          <DockButton
            glyph="↧"
            label={isExporting ? "Exporting" : "Export"}
            secondary
            onClick={onExport}
            disabled={isExporting}
          />
        </div>

        <div className="dock-more">
          <DockButton
            glyph="⋯"
            label="More"
            active={isMoreOpen}
            onClick={onToggleMore}
            buttonRef={moreButtonRef}
            ariaExpanded={isMoreOpen}
          />
        </div>
      </nav>
    </>
  );
}
