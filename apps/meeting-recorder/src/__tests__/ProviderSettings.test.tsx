import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProviderSettings from "../components/settings/ProviderSettings";

const defaultProps = {
  provider: "google",
  model: "gemini-2.0-flash",
  apiKey: "test-key",
  ollamaBaseUrl: "",
  bedrockRegion: "",
  bedrockAccessKeyId: "",
  bedrockSecretAccessKey: "",
  bedrockSessionToken: "",
  transcriptionProvider: "",
  transcriptionApiKey: "",
  onFieldChange: vi.fn(),
  onTestConnection: vi.fn(),
  testResult: null,
  testing: false,
};

describe("ProviderSettings", () => {
  it("shows audio-capable badge for Google Gemini", () => {
    render(<ProviderSettings {...defaultProps} provider="google" />);
    expect(screen.getByText("Audio-capable")).toBeTruthy();
  });

  it("shows text-only badge for non-audio providers", () => {
    render(<ProviderSettings {...defaultProps} provider="openai" />);
    expect(screen.getByText("Text-only")).toBeTruthy();
  });

  it("shows text-only badge for Anthropic", () => {
    render(<ProviderSettings {...defaultProps} provider="anthropic" />);
    expect(screen.getByText("Text-only")).toBeTruthy();
  });

  it("renders provider select with all options", () => {
    render(<ProviderSettings {...defaultProps} />);
    const select = screen.getByLabelText("Provider") as HTMLSelectElement;
    expect(select.value).toBe("google");
    expect(select.options).toHaveLength(5);
  });

  it("calls onFieldChange when provider changes", () => {
    const onFieldChange = vi.fn();
    render(
      <ProviderSettings {...defaultProps} onFieldChange={onFieldChange} />,
    );
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    expect(onFieldChange).toHaveBeenCalledWith("provider", "openai");
  });

  it("hides API key field for ollama", () => {
    render(<ProviderSettings {...defaultProps} provider="ollama" />);
    expect(screen.queryByLabelText("API Key")).toBeNull();
    expect(screen.getByLabelText("Ollama Base URL")).toBeTruthy();
  });

  it("shows bedrock fields when bedrock is selected", () => {
    render(<ProviderSettings {...defaultProps} provider="bedrock" />);
    expect(screen.getByLabelText("AWS Region")).toBeTruthy();
    expect(screen.getByLabelText("Access Key ID")).toBeTruthy();
    expect(screen.getByLabelText("Secret Access Key")).toBeTruthy();
  });

  it("shows test result success message", () => {
    render(
      <ProviderSettings
        {...defaultProps}
        testResult={{ valid: true }}
      />,
    );
    expect(screen.getByText("Connection successful")).toBeTruthy();
  });

  it("shows test result error message", () => {
    render(
      <ProviderSettings
        {...defaultProps}
        testResult={{ valid: false, error: "Invalid key" }}
      />,
    );
    expect(screen.getByText("Invalid key")).toBeTruthy();
  });

  it("disables test button while testing", () => {
    render(<ProviderSettings {...defaultProps} testing={true} />);
    const button = screen.getByText("Testing...");
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows transcription provider dropdown for text-only providers", () => {
    render(<ProviderSettings {...defaultProps} provider="openai" />);
    expect(screen.getByLabelText("Transcription Provider")).toBeTruthy();
  });

  it("shows transcription API key field for text-only providers with google transcription", () => {
    render(
      <ProviderSettings
        {...defaultProps}
        provider="openai"
        transcriptionProvider="google"
      />,
    );
    expect(screen.getByLabelText("Transcription API Key")).toBeTruthy();
  });

  it("does not show transcription provider dropdown for Google (audio-capable)", () => {
    render(<ProviderSettings {...defaultProps} provider="google" />);
    expect(screen.queryByLabelText("Transcription Provider")).toBeNull();
  });

  it("shows masked API key display when key starts with ****", () => {
    render(<ProviderSettings {...defaultProps} apiKey="****abcd" />);
    expect(screen.getByLabelText("Masked API Key")).toBeTruthy();
    expect(screen.getByText("Change")).toBeTruthy();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("shows plain API key input when key is not masked", () => {
    render(<ProviderSettings {...defaultProps} apiKey="sk-plainkey" />);
    expect(screen.getByLabelText("API Key")).toBeTruthy();
    expect(screen.queryByLabelText("Masked API Key")).toBeNull();
    expect(screen.queryByText("Change")).toBeNull();
  });

  it("clicking Change button switches masked key to input mode", () => {
    render(<ProviderSettings {...defaultProps} apiKey="****abcd" />);
    expect(screen.getByLabelText("Masked API Key")).toBeTruthy();
    fireEvent.click(screen.getByText("Change"));
    expect(screen.getByLabelText("API Key")).toBeTruthy();
    expect(screen.queryByLabelText("Masked API Key")).toBeNull();
  });
});
