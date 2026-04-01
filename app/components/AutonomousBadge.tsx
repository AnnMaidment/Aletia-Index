'use client';

/**
 * AutonomousBadge
 *
 * Displays on device cards and device detail pages when
 * autonomous_output_mode = true.
 *
 * Behaviour:
 * - Compact amber badge at rest: "Autonomous Output"
 * - Hover: tooltip with full autonomous_output_description
 * - Click: expands inline detail panel with clinical context
 *   and link to /methodology#autonomous-output
 * - If data_source = 'aletia_research' AND description is
 *   Aletia-authored (not manufacturer-verified): shows
 *   "Manufacturer — verify this claim" CTA which triggers
 *   the claim your listing flow.
 *
 * Usage:
 *   <AutonomousBadge
 *     description={device.autonomous_output_description}
 *     riskClass={device.eu_risk_class}
 *     dataSource={device.data_source}
 *     deviceId={device.device_id}
 *   />
 */

import { useState, useRef, useEffect } from 'react';

interface AutonomousBadgeProps {
  description:  string | null;
  riskClass?:   string | null;   // e.g. "Class III"
  dataSource?:  string | null;   // e.g. "aletia_research" | "manufacturer_submitted"
  deviceId:     string;
}

export function AutonomousBadge({
  description,
  riskClass,
  dataSource,
  deviceId,
}: AutonomousBadgeProps) {
  const [expanded, setExpanded]       = useState(false);
  const [tooltipVisible, setTooltip]  = useState(false);
  const tooltipTimer                  = useRef<NodeJS.Timeout | null>(null);
  const panelRef                      = useRef<HTMLDivElement>(null);

  // Manufacturer has not yet verified this claim
  const isUnverified = dataSource === 'aletia_research';

  // Close expanded panel on outside click
  useEffect(() => {
    if (!expanded) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  function handleMouseEnter() {
    tooltipTimer.current = setTimeout(() => setTooltip(true), 300);
  }
  function handleMouseLeave() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip(false);
  }

  return (
    <div className="autonomous-badge-root" ref={panelRef}>

      {/* ── Badge ─────────────────────────────────────────── */}
      <button
        className={`autonomous-badge ${isUnverified ? 'unverified' : ''}`}
        onClick={() => { setExpanded(v => !v); setTooltip(false); }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        aria-expanded={expanded}
        aria-label="Autonomous output mode — click for details"
      >
        <span className="autonomous-badge__icon" aria-hidden="true">⬡</span>
        <span className="autonomous-badge__label">Autonomous Output</span>
        {riskClass && (
          <span className="autonomous-badge__class">{riskClass}</span>
        )}
        {isUnverified && (
          <span className="autonomous-badge__unverified-dot" aria-label="Unverified" />
        )}
      </button>

      {/* ── Hover tooltip ─────────────────────────────────── */}
      {tooltipVisible && !expanded && description && (
        <div className="autonomous-tooltip" role="tooltip">
          <p>{description}</p>
          <span className="autonomous-tooltip__cta">Click for clinical context →</span>
        </div>
      )}

      {/* ── Expanded panel ────────────────────────────────── */}
      {expanded && (
        <div className="autonomous-panel" role="region" aria-label="Autonomous output details">

          <div className="autonomous-panel__header">
            <span className="autonomous-panel__icon" aria-hidden="true">⬡</span>
            <h4>Autonomous Decision Mode</h4>
            <button
              className="autonomous-panel__close"
              onClick={() => setExpanded(false)}
              aria-label="Close"
            >✕</button>
          </div>

          <p className="autonomous-panel__description">
            {description ?? 'Autonomous output mode has been flagged for this device. Full description pending clinical review.'}
          </p>

          <div className="autonomous-panel__context">
            <p>
              Devices in autonomous decision mode can produce outputs that are acted upon
              in clinical workflows without a human clinician performing a second review.
              This represents the highest level of device autonomy in the Aletia
              Accountability Tier framework (Tier 4).
            </p>
            <p>
              Clinicians and procurement teams should review deployment protocols carefully
              before implementing autonomous output workflows.
            </p>
          </div>

          <div className="autonomous-panel__footer">
            <a
              href="/methodology#autonomous-output"
              className="autonomous-panel__learn-more"
              target="_blank"
              rel="noopener"
            >
              Aletia methodology: Autonomous Output →
            </a>

            {/* ── Claim your listing trigger ─────────────── */}
            {isUnverified && (
              <div className="autonomous-panel__claim">
                <div className="autonomous-panel__claim-text">
                  <span className="autonomous-panel__claim-icon">⚠</span>
                  <div>
                    <strong>Manufacturer — is this description accurate?</strong>
                    <p>
                      This flag was applied by Aletia based on published regulatory
                      documentation. If you are the manufacturer or authorised
                      representative, claim this listing to verify, correct, or
                      add detail.
                    </p>
                  </div>
                </div>
                <a
                  href={`/request-review?device=${deviceId}&field=autonomous_output&source=badge`}
                  className="autonomous-panel__claim-btn"
                >
                  Claim this listing
                </a>
              </div>
            )}
          </div>

        </div>
      )}

      <style>{`
        /* ── Root ─────────────────────────────────────────── */
        .autonomous-badge-root {
          position: relative;
          display: inline-block;
        }

        /* ── Badge ────────────────────────────────────────── */
        .autonomous-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px 4px 8px;
          border-radius: 6px;
          border: 1.5px solid #d97706;
          background: #fffbeb;
          color: #92400e;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
          font-family: inherit;
        }
        .autonomous-badge:hover {
          background: #fef3c7;
          border-color: #b45309;
          transform: translateY(-1px);
        }
        .autonomous-badge:active {
          transform: translateY(0);
        }
        .autonomous-badge[aria-expanded="true"] {
          background: #fef3c7;
          border-color: #b45309;
        }
        .autonomous-badge.unverified {
          border-style: dashed;
        }

        .autonomous-badge__icon {
          font-size: 11px;
          color: #d97706;
        }
        .autonomous-badge__label {
          white-space: nowrap;
        }
        .autonomous-badge__class {
          padding: 1px 6px;
          border-radius: 4px;
          background: #d97706;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .autonomous-badge__unverified-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ef4444;
          margin-left: 2px;
        }

        /* ── Tooltip ──────────────────────────────────────── */
        .autonomous-tooltip {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          z-index: 50;
          width: 300px;
          padding: 12px 14px;
          border-radius: 8px;
          background: #1c1917;
          color: #fafaf9;
          font-size: 12.5px;
          line-height: 1.55;
          box-shadow: 0 8px 24px rgba(0,0,0,0.18);
          pointer-events: none;
          animation: tooltipIn 0.15s ease;
        }
        .autonomous-tooltip p {
          margin: 0 0 6px;
        }
        .autonomous-tooltip__cta {
          font-size: 11px;
          color: #d97706;
          font-weight: 600;
        }
        @keyframes tooltipIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Expanded panel ───────────────────────────────── */
        .autonomous-panel {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          z-index: 60;
          width: 380px;
          border-radius: 12px;
          border: 1.5px solid #d97706;
          background: #fff;
          box-shadow: 0 16px 48px rgba(0,0,0,0.12);
          overflow: hidden;
          animation: panelIn 0.2s ease;
        }
        @keyframes panelIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        .autonomous-panel__header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 14px 16px 12px;
          background: #fffbeb;
          border-bottom: 1px solid #fde68a;
        }
        .autonomous-panel__header h4 {
          flex: 1;
          margin: 0;
          font-size: 13.5px;
          font-weight: 700;
          color: #92400e;
          letter-spacing: 0.01em;
        }
        .autonomous-panel__icon {
          font-size: 16px;
          color: #d97706;
        }
        .autonomous-panel__close {
          background: none;
          border: none;
          color: #92400e;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 4px;
          line-height: 1;
          opacity: 0.6;
          font-family: inherit;
        }
        .autonomous-panel__close:hover {
          opacity: 1;
          background: #fde68a;
        }

        .autonomous-panel__description {
          margin: 0;
          padding: 14px 16px 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--text, #0f172a);
          line-height: 1.5;
        }

        .autonomous-panel__context {
          padding: 10px 16px 14px;
          border-bottom: 1px solid var(--line, #e6ebf3);
        }
        .autonomous-panel__context p {
          margin: 0 0 8px;
          font-size: 12.5px;
          color: var(--muted, #64748b);
          line-height: 1.55;
        }
        .autonomous-panel__context p:last-child {
          margin: 0;
        }

        .autonomous-panel__footer {
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .autonomous-panel__learn-more {
          font-size: 12px;
          color: var(--primary, #1f6feb);
          text-decoration: none;
          font-weight: 600;
        }
        .autonomous-panel__learn-more:hover {
          text-decoration: underline;
        }

        /* ── Claim trigger ────────────────────────────────── */
        .autonomous-panel__claim {
          border-radius: 8px;
          border: 1.5px solid #fee2e2;
          background: #fef2f2;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .autonomous-panel__claim-text {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .autonomous-panel__claim-icon {
          font-size: 16px;
          color: #ef4444;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .autonomous-panel__claim-text strong {
          display: block;
          font-size: 12.5px;
          color: #991b1b;
          margin-bottom: 4px;
        }
        .autonomous-panel__claim-text p {
          margin: 0;
          font-size: 12px;
          color: #7f1d1d;
          line-height: 1.5;
        }
        .autonomous-panel__claim-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 16px;
          border-radius: 6px;
          background: #ef4444;
          color: #fff;
          font-size: 12.5px;
          font-weight: 700;
          text-decoration: none;
          letter-spacing: 0.01em;
          transition: background 0.15s;
          align-self: flex-start;
        }
        .autonomous-panel__claim-btn:hover {
          background: #dc2626;
        }
      `}</style>
    </div>
  );
}
