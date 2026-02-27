import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MeetingTypeSelector from "../components/MeetingTypeSelector";

const defaultTypes = [
  {
    id: "mt-general",
    name: "General Meeting",
    description: "Standard meeting format",
    icon: "calendar",
    prompt_template: "Summarize the meeting.",
    is_default: 1,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "mt-standup",
    name: "Standup",
    description: "Daily standup",
    icon: "clock",
    prompt_template: "Summarize standup.",
    is_default: 1,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "mt-interview",
    name: "Interview",
    description: "Job interview",
    icon: "user-check",
    prompt_template: "Summarize interview.",
    is_default: 1,
    created_at: "2026-01-01T00:00:00Z",
  },
];

describe("MeetingTypeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with all meeting types", () => {
    render(
      <MeetingTypeSelector
        meetingTypes={defaultTypes}
        selectedTypeId={null}
        onSelect={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox");
    expect(select).toBeTruthy();
  });

  it("shows 'No type selected' when selectedTypeId is null", () => {
    render(
      <MeetingTypeSelector
        meetingTypes={defaultTypes}
        selectedTypeId={null}
        onSelect={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("shows selected type when selectedTypeId is provided", () => {
    render(
      <MeetingTypeSelector
        meetingTypes={defaultTypes}
        selectedTypeId="mt-standup"
        onSelect={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("mt-standup");
  });

  it("calls onSelect when a type is chosen", () => {
    const onSelect = vi.fn();
    render(
      <MeetingTypeSelector
        meetingTypes={defaultTypes}
        selectedTypeId={null}
        onSelect={onSelect}
      />,
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "mt-interview" } });

    expect(onSelect).toHaveBeenCalledWith("mt-interview");
  });

  it("calls onSelect with null when 'None' is chosen", () => {
    const onSelect = vi.fn();
    render(
      <MeetingTypeSelector
        meetingTypes={defaultTypes}
        selectedTypeId="mt-general"
        onSelect={onSelect}
      />,
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "" } });

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("lists all meeting types as options", () => {
    render(
      <MeetingTypeSelector
        meetingTypes={defaultTypes}
        selectedTypeId={null}
        onSelect={vi.fn()}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options.length).toBe(4);
    expect(options[0]).toHaveTextContent("None");
    expect(options[1]).toHaveTextContent("General Meeting");
    expect(options[2]).toHaveTextContent("Standup");
    expect(options[3]).toHaveTextContent("Interview");
  });

  it("renders with empty types list", () => {
    render(
      <MeetingTypeSelector
        meetingTypes={[]}
        selectedTypeId={null}
        onSelect={vi.fn()}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options.length).toBe(1);
  });
});
