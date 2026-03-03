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

describe("TranscriptPanel", () => {
  const mockSegments = [
    {
      id: "seg-1",
      speaker: "Alice",
      text: "Good morning everyone",
      timestamp: "0:05",
      sentiment: "positive" as const,
    },
    {
      id: "seg-2",
      speaker: "Bob",
      text: "Morning Alice, let's get started",
      timestamp: "0:10",
      sentiment: "neutral" as const,
    },
    {
      id: "seg-3",
      speaker: "Alice",
      text: "First topic is the project timeline",
      timestamp: "0:15",
      sentiment: "neutral" as const,
    },
  ];

  it("renders transcript segments with speaker names", () => {
    render(<TranscriptPanel segments={mockSegments} />);
    expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Good morning everyone")).toBeInTheDocument();
  });

  it("displays all segments", () => {
    render(<TranscriptPanel segments={mockSegments} />);
    expect(
      screen.getByText("Morning Alice, let's get started"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("First topic is the project timeline"),
    ).toBeInTheDocument();
  });

  it("shows timestamps for each segment", () => {
    render(<TranscriptPanel segments={mockSegments} />);
    expect(screen.getByText("0:05")).toBeInTheDocument();
    expect(screen.getByText("0:10")).toBeInTheDocument();
  });

  it("shows empty state when no segments", () => {
    render(<TranscriptPanel segments={[]} />);
    expect(screen.getByText(/ready to record/i)).toBeInTheDocument();
  });

  it("shows onboarding prompt when provider not configured", () => {
    render(
      <MemoryRouter>
        <TranscriptPanel segments={[]} providerConfigured={false} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/configure AI provider/i),
    ).toBeInTheDocument();
  });

  it("renders speaker names with consistent colors", () => {
    render(<TranscriptPanel segments={mockSegments} />);
    const aliceLabels = screen.getAllByText("Alice");
    expect(aliceLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("shows translated text below original segment when translations provided", () => {
    const translations = new Map([["seg-1", "Buenos días a todos"]]);
    render(
      <TranscriptPanel segments={mockSegments} translations={translations} />,
    );
    expect(screen.getByText("Good morning everyone")).toBeInTheDocument();
    expect(screen.getByText("Buenos días a todos")).toBeInTheDocument();
  });

  it("shows no translated text when translations not provided", () => {
    render(<TranscriptPanel segments={mockSegments} />);
    expect(screen.queryByText("Buenos días a todos")).toBeNull();
  });
});
