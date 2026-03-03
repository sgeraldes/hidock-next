import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TranscriptPanel } from "../components/TranscriptPanel";

let originalOffsetHeight: PropertyDescriptor | undefined;
let originalOffsetWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  originalOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
});

afterAll(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      originalOffsetHeight,
    );
  }
  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth,
    );
  }
});

const mockSegments = [
  {
    id: "seg-1",
    speaker: "Alice",
    text: "Good morning everyone",
    timestamp: "0:00",
    sentiment: "positive" as const,
  },
  {
    id: "seg-2",
    speaker: "Bob",
    text: "Good morning Alice",
    timestamp: "0:03",
    sentiment: "neutral" as const,
  },
];

describe("InterimResults", () => {
  it("renders interim result with distinct styling", () => {
    const interimResult = {
      text: "I think we should",
      speaker: "...",
      timestamp: "1:23",
    };

    render(
      <MemoryRouter>
        <TranscriptPanel
          segments={mockSegments}
          interimResult={interimResult}
        />
      </MemoryRouter>,
    );

    const interimText = screen.getByText("I think we should");
    expect(interimText).toBeInTheDocument();
    expect(interimText).toHaveClass("italic");
    expect(interimText).toHaveClass("text-muted-foreground");
  });

  it("shows only the latest interim text, not previous partials", () => {
    const { rerender } = render(
      <MemoryRouter>
        <TranscriptPanel
          segments={mockSegments}
          interimResult={{ text: "I think", speaker: "...", timestamp: "1:23" }}
        />
      </MemoryRouter>,
    );

    rerender(
      <MemoryRouter>
        <TranscriptPanel
          segments={mockSegments}
          interimResult={{
            text: "I think we should discuss",
            speaker: "...",
            timestamp: "1:23",
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("I think we should discuss")).toBeInTheDocument();
    // The previous partial "I think" alone should not be visible as a separate element
    const allInterimTexts = screen.getAllByText(/I think/);
    expect(allInterimTexts).toHaveLength(1);
  });

  it("removes interim row when interimResult is null", () => {
    const { rerender } = render(
      <MemoryRouter>
        <TranscriptPanel
          segments={mockSegments}
          interimResult={{ text: "partial text", speaker: "...", timestamp: "1:23" }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("partial text")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TranscriptPanel segments={mockSegments} interimResult={null} />
      </MemoryRouter>,
    );

    expect(screen.queryByText("partial text")).not.toBeInTheDocument();
  });

  it("renders normally without interimResult prop", () => {
    render(
      <MemoryRouter>
        <TranscriptPanel segments={mockSegments} />
      </MemoryRouter>,
    );

    // Should render all segments without error
    expect(screen.getByText("Good morning everyone")).toBeInTheDocument();
    // No interim-specific elements (speaker "..." should not appear)
    const speakers = screen.getAllByText(/Alice|Bob/);
    expect(speakers.length).toBeGreaterThan(0);
    // "..." speaker should not be present when no interim result
    expect(screen.queryByText("...")).not.toBeInTheDocument();
  });

  it("positions interim row after all final segments", () => {
    render(
      <MemoryRouter>
        <TranscriptPanel
          segments={mockSegments}
          interimResult={{ text: "new partial", speaker: "...", timestamp: "2:00" }}
        />
      </MemoryRouter>,
    );

    // The virtualizer should have count = segments.length + 1
    // We verify the interim row has data-index = segments.length
    const interimText = screen.getByText("new partial");
    const interimRow = interimText.closest("[data-index]");
    expect(interimRow).toHaveAttribute("data-index", String(mockSegments.length));
  });

  it("shows a blinking cursor indicator on the interim row", () => {
    render(
      <MemoryRouter>
        <TranscriptPanel
          segments={mockSegments}
          interimResult={{ text: "speaking now", speaker: "...", timestamp: "1:00" }}
        />
      </MemoryRouter>,
    );

    const interimText = screen.getByText("speaking now");
    const cursor = interimText.querySelector(".animate-pulse");
    expect(cursor).toBeInTheDocument();
  });
});
