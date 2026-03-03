import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProviderSettings from "../components/settings/ProviderSettings";

const mockGoogleModels = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Fast & cost-effective",
    costMultiplier: 1,
    contexts: ["realtime", "postprocess"],
    capabilities: ["audio", "multimodal"],
    recommended: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Higher quality (~10x cost)",
    costMultiplier: 10,
    contexts: ["critical", "postprocess"],
    capabilities: ["audio", "multimodal"],
  },
];

beforeEach(() => {
  window.electronAPI = {
    models: {
      getConfig: vi.fn().mockResolvedValue({
        version: 1,
        providers: {
          google: { defaultModel: "gemini-2.5-flash" },
          openai: { defaultModel: "gpt-4o" },
          anthropic: { defaultModel: "claude-sonnet-4-20250514" },
          bedrock: { defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0" },
          ollama: { defaultModel: "llama3.2" },
        },
        contexts: {},
      }),
      getForProvider: vi.fn().mockResolvedValue(mockGoogleModels),
      getActiveForProvider: vi.fn().mockResolvedValue(mockGoogleModels),
      getForContext: vi.fn().mockResolvedValue("gemini-2.5-flash"),
      getContexts: vi.fn().mockResolvedValue({}),
      validate: vi.fn().mockResolvedValue({ valid: true, deprecated: false, migratesTo: null }),
      getCostMultiplier: vi.fn().mockResolvedValue(1),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
      testConnection: vi.fn().mockResolvedValue({ valid: true }),
    },
  } as unknown as typeof window.electronAPI;
});

const defaultProps = {
  provider: "google",
  model: "gemini-2.5-flash",
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
  it("renders provider select with all options", async () => {
    render(<ProviderSettings {...defaultProps} />);
    const select = screen.getByLabelText("AI provider") as HTMLSelectElement;
    expect(select.value).toBe("google");
    expect(select.options).toHaveLength(5);
  });

  it("calls onFieldChange when provider changes", async () => {
    const onFieldChange = vi.fn();
    render(
      <ProviderSettings {...defaultProps} onFieldChange={onFieldChange} />,
    );
    fireEvent.change(screen.getByLabelText("AI provider"), {
      target: { value: "openai" },
    });
    expect(onFieldChange).toHaveBeenCalledWith("provider", "openai");
  });

  it("shows audio transcription warning for text-only providers", async () => {
    render(<ProviderSettings {...defaultProps} provider="openai" />);
    await waitFor(() => {
      expect(screen.getByText("Audio transcription required")).toBeTruthy();
    });
  });

  it("does not show audio transcription warning for Google (audio-capable)", async () => {
    render(<ProviderSettings {...defaultProps} provider="google" />);
    expect(screen.queryByText("Audio transcription required")).toBeNull();
  });

  it("hides API key field for ollama", async () => {
    render(<ProviderSettings {...defaultProps} provider="ollama" />);
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.getByLabelText("Ollama server URL")).toBeTruthy();
  });

  it("shows bedrock fields when bedrock is selected", async () => {
    render(<ProviderSettings {...defaultProps} provider="bedrock" />);
    expect(screen.getByLabelText("AWS region")).toBeTruthy();
    expect(screen.getByLabelText("Access key ID")).toBeTruthy();
    expect(screen.getByLabelText("Secret access key")).toBeTruthy();
  });

  it("shows test result success message", async () => {
    render(
      <ProviderSettings
        {...defaultProps}
        testResult={{ valid: true }}
      />,
    );
    expect(screen.getByText("Connection successful")).toBeTruthy();
  });

  it("shows test result error message", async () => {
    render(
      <ProviderSettings
        {...defaultProps}
        testResult={{ valid: false, error: "Invalid key" }}
      />,
    );
    expect(screen.getByText("Invalid key")).toBeTruthy();
  });

  it("disables test button while testing", async () => {
    render(<ProviderSettings {...defaultProps} testing={true} />);
    const button = screen.getByText("Testing...");
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows transcription provider dropdown for text-only providers", async () => {
    render(<ProviderSettings {...defaultProps} provider="openai" />);
    expect(screen.getByLabelText("Transcription provider")).toBeTruthy();
  });

  it("shows transcription API key field for text-only providers with google transcription", async () => {
    render(
      <ProviderSettings
        {...defaultProps}
        provider="openai"
        transcriptionProvider="google"
      />,
    );
    expect(screen.getByLabelText("Google API key (for transcription)")).toBeTruthy();
  });

  it("does not show transcription provider dropdown for Google (audio-capable)", async () => {
    render(<ProviderSettings {...defaultProps} provider="google" />);
    expect(screen.queryByLabelText("Transcription provider")).toBeNull();
  });

  it("shows masked API key display with Change button", async () => {
    render(<ProviderSettings {...defaultProps} apiKey="****abcd" />);
    expect(screen.getByText("****abcd")).toBeTruthy();
    expect(screen.getByText("Change")).toBeTruthy();
    // When masked, the password input is not shown
    expect(screen.queryByLabelText("API key")).toBeNull();
  });

  it("shows plain API key input when key is not masked", async () => {
    render(<ProviderSettings {...defaultProps} apiKey="sk-plainkey" />);
    expect(screen.getByLabelText("API key")).toBeTruthy();
    expect(screen.queryByText("Change")).toBeNull();
  });

  it("clicking Change button switches masked key to input mode", async () => {
    render(<ProviderSettings {...defaultProps} apiKey="****abcd" />);
    expect(screen.getByText("****abcd")).toBeTruthy();
    fireEvent.click(screen.getByText("Change"));
    expect(screen.getByLabelText("API key")).toBeTruthy();
  });

  it("renders ModelSelector for model selection", async () => {
    render(<ProviderSettings {...defaultProps} />);
    // ModelSelector should load models and render a dropdown
    await waitFor(() => {
      expect(screen.getByLabelText("Select AI model")).toBeTruthy();
    });
  });

  it("ModelSelector shows model badge and description", async () => {
    render(<ProviderSettings {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Recommended")).toBeTruthy();
      expect(screen.getByText("Fast & cost-effective")).toBeTruthy();
    });
  });
});
