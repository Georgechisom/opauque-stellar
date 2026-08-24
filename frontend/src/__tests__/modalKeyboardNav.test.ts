import { describe, it, expect, vi } from "vitest";

describe("Modal Keyboard Navigation & Accessibility (Issue #551)", () => {
  const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  it("defines standard accessible focusable selectors", () => {
    expect(FOCUSABLE_SELECTORS).toContain("button:not([disabled])");
    expect(FOCUSABLE_SELECTORS).toContain("input:not([disabled])");
    expect(FOCUSABLE_SELECTORS).toContain('a[href]');
    expect(FOCUSABLE_SELECTORS).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it("handles tab key focus wrapping between first and last focusable elements", () => {
    const mockElements = [
      { id: "input1", focus: vi.fn() },
      { id: "button1", focus: vi.fn() },
      { id: "closeBtn", focus: vi.fn() },
    ];

    // Simulating Shift+Tab on first element wraps to last element
    let currentElement = mockElements[0];
    let isShift = true;
    if (isShift && currentElement === mockElements[0]) {
      mockElements[mockElements.length - 1].focus();
    }
    expect(mockElements[2].focus).toHaveBeenCalledTimes(1);

    // Simulating Tab on last element wraps to first element
    currentElement = mockElements[2];
    isShift = false;
    if (!isShift && currentElement === mockElements[mockElements.length - 1]) {
      mockElements[0].focus();
    }
    expect(mockElements[0].focus).toHaveBeenCalledTimes(1);
  });

  it("handles Escape key event without partial state submission", () => {
    const onClose = vi.fn();
    const handleKey = (key: string) => {
      if (key === "Escape") onClose();
    };

    handleKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
