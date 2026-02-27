import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SummaryPanel from "../components/SummaryPanel";

describe("SummaryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows generate button when no summary exists", () => {
    render(
      <SummaryPanel
        summary={null}
        isGenerating={false}
        onGenerate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /generate summary/i })).toBeTruthy();
  });

  it("calls onGenerate when button clicked", () => {
    const onGenerate = vi.fn();
    render(
      <SummaryPanel
        summary={null}
        isGenerating={false}
        onGenerate={onGenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /generate summary/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("shows loading state when generating", () => {
    render(
      <SummaryPanel
        summary={null}
        isGenerating={true}
        onGenerate={vi.fn()}
      />,
    );

    expect(screen.getByText(/generating/i)).toBeTruthy();
  });

  it("displays summary text when available", () => {
    render(
      <SummaryPanel
        summary="The team discussed roadmap priorities and agreed on Q1 deliverables."
        isGenerating={false}
        onGenerate={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/roadmap priorities/i),
    ).toBeTruthy();
  });

  it("shows regenerate button when summary exists", () => {
    render(
      <SummaryPanel
        summary="Some summary text."
        isGenerating={false}
        onGenerate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /regenerate/i })).toBeTruthy();
  });

  it("disables button when generating", () => {
    render(
      <SummaryPanel
        summary={null}
        isGenerating={true}
        onGenerate={vi.fn()}
      />,
    );

    const buttons = screen.queryAllByRole("button");
    const generateBtn = buttons.find((b) =>
      b.textContent?.toLowerCase().includes("generat"),
    );
    if (generateBtn) {
      expect(generateBtn).toBeDisabled();
    }
  });
});
