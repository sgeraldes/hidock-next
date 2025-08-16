# AGENT Files Index

This document provides an overview of all AI agent operational rule files in the HiDock Next repository. Each AGENT file contains mandatory, non-negotiable procedures that AI coding assistants must follow when working on different parts of the project.

## Agent Files Overview

### **Root Level Agent**
**File:** [`AGENT.md`](./AGENT.md)
**Purpose:** Multi-platform project coordination and cross-component standards
**Scope:** Project-wide rules, git workflow, AI provider coordination, documentation standards
**Format:** Operational procedures for managing the entire HiDock Next ecosystem
**Key Requirements:**
- Component-specific rules precedence over general rules
- Multi-platform consistency enforcement (Desktop, Web, Audio Insights)
- Conventional commit workflow and proper testing procedures
- 11 AI provider coordination across all components
- Cross-component validation and integration requirements

---

### **Desktop Application Agent**
**File:** [`hidock-desktop-app/AGENT.md`](./hidock-desktop-app/AGENT.md)
**Purpose:** Python GUI development operational procedures
**Scope:** CustomTkinter desktop application with USB device communication
**Format:** Mandatory workflows for Python development with strict quality gates
**Key Requirements:**
- Follow `.amazonq/rules/PYTHON.md` TDD procedures
- CustomTkinter component patterns with exact code structures
- USB thread safety with background threading requirements
- Audio memory management and pygame cleanup procedures
- Performance requirements: startup <3s, USB ops <5s, memory <200MB

---

### **Web Application Agent**
**File:** [`hidock-web-app/AGENT.md`](./hidock-web-app/AGENT.md)
**Purpose:** React TypeScript web development operational procedures
**Scope:** React 18 + Zustand web application with WebUSB device communication
**Format:** Mandatory patterns for modern web development with strict testing
**Key Requirements:**
- React 18 + Zustand state management (never Redux or Context API)
- WebUSB API mandatory for all device communication
- Multi-provider AI integration (11 providers with exact configuration)
- TypeScript strict mode with zero errors and no `any` types
- Performance requirements: initial load <2s, operations <100ms

---

### **Audio Insights Extractor Agent**
**File:** [`audio-insights-extractor/AGENT.md`](./audio-insights-extractor/AGENT.md)
**Purpose:** React 19 audio analysis development operational procedures
**Scope:** Standalone browser-based audio transcription and analysis prototype
**Format:** Modern React development with Google Gemini AI integration
**Key Requirements:**
- React 19 with concurrent features and automatic batching
- Google Gemini AI exclusive integration (no other providers)
- Browser-only audio processing with Web Audio API
- TypeScript strict mode with comprehensive error boundaries
- Performance requirements: bundle <1MB, processing start <500ms

---

### **Documentation Agent Template**
**File:** [`docs/AGENT_DEFAULT.md`](./docs/AGENT_DEFAULT.md)
**Purpose:** Comprehensive template for creating AI agent operational procedures
**Scope:** Meta-documentation for building effective agent instruction systems
**Format:** Template showing best practices for AI agent guidance documents
**Key Requirements:**
- PRAR workflow methodology (Perceive, Reason, Act, Refine)
- State-gated execution protocols with clear operational modes
- Technology decision frameworks with specific implementation patterns
- Quality gates and deployment procedures with validation commands

## Agent Specialization Summary

| Component          | Agent File                             | Format                       | Primary Technology   | Operational Focus                          |
| ------------------ | -------------------------------------- | ---------------------------- | -------------------- | ------------------------------------------ |
| **Root Project**   | ✅ `AGENT.md`                          | Cross-component coordination | Multi-platform       | Project workflow, AI provider coordination |
| **Web App**        | ✅ `hidock-web-app/AGENT.md`           | Mandatory procedures         | React 18/TypeScript  | WebUSB, Zustand, 11 AI providers           |
| **Desktop App**    | ✅ `hidock-desktop-app/AGENT.md`       | Operational rules            | Python/CustomTkinter | USB threading, GUI patterns, TDD           |
| **Audio Insights** | ✅ `audio-insights-extractor/AGENT.md` | Development procedures       | React 19/TypeScript  | Gemini AI, browser audio processing        |
| **Template**       | ✅ `docs/AGENT_DEFAULT.md`             | Meta-template                | Documentation        | Agent creation methodology                 |

## Key Differences from Generic Documentation

### **Operational Rules vs. Documentation**
These AGENT files are **operational procedures**, not general documentation:

- **Mandatory Commands:** Exact terminal commands that must be executed
- **Required Patterns:** Specific code structures that must be followed
- **Quality Gates:** Non-negotiable validation requirements
- **Forbidden Actions:** Explicit restrictions on tools and approaches

### **Precision vs. Generalization**
Unlike typical documentation, these files provide:

- **Exact Code Templates:** Copy-paste ready code structures
- **Specific Tool Commands:** Precise syntax for validation tools
- **Measurable Requirements:** Performance metrics and thresholds
- **Enforcement Mechanisms:** Automated validation and testing procedures

### **Priority: Maintain Operational Standards**

- **Enforce mandatory procedures** across all AI coding assistants
- **Update operational rules** when technology stacks evolve
- **Maintain consistency** between actual codebase and operational procedures
- **Regular validation** that all quality gates remain achievable

## Usage Guidelines

### **For AI Coding Assistants:**
1. **Read component-specific AGENT file** before making any code changes
2. **Follow mandatory procedures exactly** - no variations or interpretations
3. **Execute all validation commands** before considering work complete
4. **Never modify configuration files** to bypass quality gates

### **For Human Developers:**
1. **Review AGENT files** to understand AI assistant operational constraints
2. **Update AGENT files** when making architectural or tooling changes
3. **Ensure operational procedures** match actual project requirements
4. **Test validation commands** after any development environment changes

## Maintenance Procedures

This index and all AGENT files should be updated when:

- **New components are added** to the project structure
- **Technology stacks change** (version upgrades, tool replacements)
- **Quality standards evolve** (new linting rules, testing requirements)
- **Development workflows change** (CI/CD updates, branching strategies)

The operational nature of these files requires they stay precisely aligned with the actual codebase and development practices.

---

*Last updated: August 4, 2025*
*For operational questions, refer to component-specific AGENT files or `.amazonq/rules/` documentation.*
