import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TalkingPointsPanel from "../components/TalkingPointsPanel";

describe("TalkingPointsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders topics with timestamps", () => {
    render(
      <TalkingPointsPanel
        topics={[
          { topic: "Q1 Roadmap", firstMentionedMs: 5000 },
          { topic: "Budget Review", firstMentionedMs: 120000 },
        ]}
        onTopicClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Q1 Roadmap")).toBeTruthy();
    expect(screen.getByText("Budget Review")).toBeTruthy();
    expect(screen.getByText("0:05")).toBeTruthy();
    expect(screen.getByText("2:00")).toBeTruthy();
  });

  it("calls onTopicClick with timestamp when topic clicked", () => {
    const onTopicClick = vi.fn();
    render(
      <TalkingPointsPanel
        topics={[{ topic: "API Design", firstMentionedMs: 30000 }]}
        onTopicClick={onTopicClick}
      />,
    );

    fireEvent.click(screen.getByText("API Design"));
    expect(onTopicClick).toHaveBeenCalledWith(30000);
  });

  it("shows empty state when no topics", () => {
    render(<TalkingPointsPanel topics={[]} onTopicClick={vi.fn()} />);

    expect(screen.getByText(/no topics/i)).toBeTruthy();
  });

  it("renders topics in order", () => {
    render(
      <TalkingPointsPanel
        topics={[
          { topic: "First", firstMentionedMs: 1000 },
          { topic: "Second", firstMentionedMs: 2000 },
          { topic: "Third", firstMentionedMs: 3000 },
        ]}
        onTopicClick={vi.fn()}
      />,
    );

    const items = screen.getAllByRole("button");
    expect(items[0]).toHaveTextContent("First");
    expect(items[1]).toHaveTextContent("Second");
    expect(items[2]).toHaveTextContent("Third");
  });
});
