# AI Assistant Operational Rules: HiDock Next Project

This document contains the mandatory, non-negotiable rules and procedures for all development across the HiDock Next multi-platform project. As an AI assistant, you must adhere to these rules without exception. Component-specific rules are defined in each component's `AGENT.md` file.

---

## 1. Core Directives

- **Component-Specific Rules First:** Always consult the component-specific `AGENT.md` file for the technology you're working with before applying these general rules.

- **Multi-Platform Consistency:** Changes must maintain consistency across Desktop (Python), Web (React/TypeScript), and Audio Insights (React) applications.

- **Git Workflow Mandatory:** All development must follow conventional commits, feature branch workflow, and proper testing before commits.

- **Documentation Updates Required:** Any changes to architecture, APIs, or configuration must be reflected in the appropriate documentation files.

- **No Cross-Component Breaking Changes:** Changes in one component must not break functionality in other components without explicit coordination.

## 2. Project Structure Requirements

### Repository Organization

The project must maintain this exact structure:

```text
hidock-next/
├── .amazonq/rules/              # AI assistant operational rules
│   ├── PYTHON.md               # Python development rules
│   ├── ARCHITECTURE.md         # Architecture requirements
│   └── MARKDOWN.md             # Documentation standards
├── hidock-desktop-app/         # Python GUI application
│   ├── AGENT.md               # Desktop-specific rules
│   ├── src/                   # Source code
│   ├── tests/                 # Test files
│   ├── requirements.txt       # Python dependencies
│   └── pyproject.toml        # Python project configuration
├── hidock-web-app/            # React web application
│   ├── AGENT.md              # Web app-specific rules
│   ├── src/                  # Source code
│   ├── package.json          # Node.js dependencies
│   └── vite.config.ts        # Vite configuration
├── audio-insights-extractor/  # React audio analysis tool
│   ├── AGENT.md             # Audio insights-specific rules
│   ├── src/                 # Source code
│   └── package.json         # Node.js dependencies
├── docs/                    # Project documentation
├── INDEX_AGENTS.md          # Agent files documentation
├── README.md               # Main project documentation
└── CONTRIBUTING.md         # Contribution guidelines
```

## 3. Technology Stack Coordination

### Shared Standards Across Components

All components must adhere to these standards:

#### Version Control
- **Git Conventional Commits:** All commits must follow the format: `<type>: <description>`
- **Branch Naming:** Use `feature/`, `fix/`, `docs/` prefixes
- **No Direct Main Commits:** All changes must go through feature branches

#### AI Provider Integration
- **11 AI Providers Supported:** OpenAI, Anthropic, Google, Azure, AWS, HuggingFace, Cohere, Replicate, Together, Perplexity, DeepSeek
- **Consistent Provider Interface:** All components must use the same provider configuration format
- **API Key Security:** Never commit API keys; use environment variables or secure storage

#### Documentation Standards
- **Markdown Compliance:** All documentation must pass `.markdownlint.json` rules
- **120 Character Line Length:** Maximum line length for all text files
- **Update INDEX_AGENTS.md:** When creating or modifying AGENT files, update the index

## 4. Cross-Component Development Workflow

### Step 1: Determine Working Component

Before making any changes, identify which component(s) you're working with:

```bash
# Desktop application (Python)
cd hidock-desktop-app/
# Follow rules in hidock-desktop-app/AGENT.md

# Web application (React/TypeScript)
cd hidock-web-app/
# Follow rules in hidock-web-app/AGENT.md

# Audio insights (React/TypeScript)
cd audio-insights-extractor/
# Follow rules in audio-insights-extractor/AGENT.md
```

### Step 2: Apply Component-Specific Rules

Each component has mandatory operational procedures defined in its `AGENT.md` file:

- **Desktop App:** Python TDD, CustomTkinter patterns, USB threading, audio processing
- **Web App:** React 18 + Zustand, WebUSB API, multi-provider AI, TypeScript strict mode
- **Audio Insights:** React 19 + Vite, Google Gemini only, browser-based audio processing

### Step 3: Cross-Component Validation

When changes affect multiple components, validate across the entire project:

```bash
# Python components
cd hidock-desktop-app/
python -m pytest
python -m black . --check
python -m flake8 .
mypy .

# React components
cd hidock-web-app/
npm run test
npm run build
npx tsc --noEmit

cd audio-insights-extractor/
npm run test
npm run build
npx tsc --noEmit

# Documentation
markdownlint **/*.md
```

## 5. AI Provider Configuration Standards

### Provider Interface Requirements

All components must implement this exact provider interface:

```typescript
interface AIProvider {
  id: 'openai' | 'anthropic' | 'google' | 'azure' | 'aws' | 'huggingface' |
      'cohere' | 'replicate' | 'together' | 'perplexity' | 'deepseek';
  name: string;
  apiKeyRequired: boolean;
  models: string[];
  endpoint: string;
  supportedFeatures: ('transcription' | 'analysis' | 'chat')[];
}
```

### Configuration File Format

All components must support this configuration structure:

```json
{
  "ai": {
    "providers": {
      "openai": {
        "apiKey": "env:OPENAI_API_KEY",
        "model": "whisper-1",
        "enabled": true
      },
      "anthropic": {
        "apiKey": "env:ANTHROPIC_API_KEY",
        "model": "claude-3-sonnet",
        "enabled": true
      }
    },
    "defaultProvider": "openai"
  }
}
```

## 6. Device Communication Standards

### USB Device Interface

Both desktop and web applications must support the same device interface:

```python
# Desktop (Python/PyUSB)
class HiDockDevice:
    def __init__(self, vendor_id: int = 0x1234, product_id: int = 0x5678):
        self.vendor_id = vendor_id
        self.product_id = product_id

    async def connect(self) -> bool:
        # Implementation
        pass
```

```typescript
// Web (WebUSB)
class HiDockDevice {
  constructor(
    private vendorId: number = 0x1234,
    private productId: number = 0x5678
  ) {}

  async connect(): Promise<boolean> {
    // Implementation
  }
}
```

### Audio File Format Support

All components must support these exact audio formats:

- **HDA Format:** Native HiDock format (proprietary)
- **WAV:** Uncompressed audio (primary)
- **MP3:** Compressed audio (secondary)
- **FLAC:** Lossless compression (optional)
- **M4A:** Apple format (optional)

## 7. Mandatory Testing Coordination

### Cross-Component Integration Tests

When developing features that span multiple components:

```bash
# Test desktop-web integration
cd hidock-desktop-app/
python -m pytest tests/test_integration/ -v

# Test shared AI provider configurations
cd hidock-web-app/
npm run test:integration

# Test audio format compatibility
cd audio-insights-extractor/
npm run test:formats
```

### Performance Requirements Across Components

All components must meet these requirements:

- **Desktop App:** Startup < 3 seconds, USB operations < 5 seconds
- **Web App:** Initial load < 2 seconds, WebUSB operations < 3 seconds
- **Audio Insights:** Bundle < 1MB, processing start < 500ms

## 8. Documentation Maintenance Requirements

### README.md Updates

When making significant changes, update the main README.md:

- **Recently Completed Section:** Add feature descriptions with dates
- **Installation Instructions:** Update if dependencies change
- **Architecture Diagrams:** Update if structure changes

### INDEX_AGENTS.md Maintenance

When modifying AGENT files:

```bash
# Update the agent files index
# Add new sections for new components
# Update status from "Missing" to "Present"
# Modify feature lists when capabilities change
```

## 9. Quality Gates for Multi-Component Changes

### Mandatory Validation Sequence

Before committing changes that affect multiple components:

```bash
# 1. Component-specific validation
cd hidock-desktop-app/ && python -m pytest && python -m black . --check
cd hidock-web-app/ && npm test && npm run build
cd audio-insights-extractor/ && npm test && npm run build

# 2. Documentation validation
markdownlint **/*.md
# Fix any markdown linting errors

# 3. Cross-component compatibility check
# Verify shared interfaces haven't broken
# Test AI provider configurations work across components

# 4. Integration test suite
python scripts/test_integration.py  # If exists
```

### Release Coordination

When preparing releases:

1. **Version Alignment:** Ensure all components use compatible versions
2. **Dependency Updates:** Coordinate dependency updates across components
3. **Documentation Sync:** Update all README files with new features
4. **Migration Guides:** Provide upgrade instructions if breaking changes exist

## 10. Emergency Procedures

### Component Isolation

If one component breaks the build:

```bash
# Temporarily disable broken component
git checkout HEAD~1 -- broken-component/
# Continue work on other components
# Fix broken component in separate branch
```

### Rollback Procedures

For critical issues affecting multiple components:

1. **Identify Last Known Good State:** Use git history to find stable commit
2. **Component-by-Component Rollback:** Roll back only affected components
3. **Dependency Resolution:** Check for cross-component dependency issues
4. **Validation:** Run full test suite before deployment

## 11. Development Environment Setup

### Required Tools Across All Components

```bash
# Global tools
npm install -g typescript@5.0
pip install black flake8 mypy pytest
brew install markdownlint-cli  # or equivalent

# Component-specific setup
cd hidock-desktop-app/ && pip install -e ".[dev]"
cd hidock-web-app/ && npm install
cd audio-insights-extractor/ && npm install
```

### Environment Variables

Set these environment variables for development:

```bash
# AI Provider API Keys (optional for development)
export OPENAI_API_KEY="your-key-here"
export ANTHROPIC_API_KEY="your-key-here"
export GOOGLE_AI_API_KEY="your-key-here"

# Development flags
export NODE_ENV="development"
export PYTHON_ENV="development"
```

These rules ensure consistency and quality across the entire HiDock Next project. Component-specific rules in each `AGENT.md` file provide detailed implementation guidance for each technology stack.
