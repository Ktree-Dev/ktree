# Ktree: Knowledge-Tree Builder for Code Repositories

[![GitHub issues](https://img.shields.io/github/issues/Ktree-Dev/ktree)](https://github.com/Ktree-Dev/ktree/issues)
[![GitHub stars](https://img.shields.io/github/stars/Ktree-Dev/ktree)](https://github.com/Ktree-Dev/ktree/stargazers)

Ktree is an automated tool that transforms large code repositories into navigable knowledge trees, making it easier for developers to understand, explore, and query complex codebases. It builds two complementary views: a **physical tree** mirroring the directory structure and an **ontology tree** organizing code by functional domains (e.g., "Authentication", "Database", "UI"). Powered by large-language models (LLMs) like Claude or GPT, Ktree generates summaries, embeddings, and semantic groupings to enable fast searches and context retrieval.

Whether you're onboarding to a new project, debugging a legacy system, or integrating with AI-assisted coding, Ktree reduces cognitive load by providing a "codebase map" – summaries, metrics, and relationships at your fingertips.

## Why Use Ktree?

In modern software projects with hundreds of thousands of lines of code (LOC) across thousands of files, navigating and comprehending the codebase is a major bottleneck. Developers waste hours sifting through files, guessing where functionality lives, or piecing together scattered docs.

Ktree solves this by:
- **Automating Codebase Mapping**: Ingests your Git repo and produces structured trees with AI-generated summaries for files, directories, and functional topics.
- **Enabling Semantic Search**: Query your codebase in natural language (e.g., "How are passwords hashed?") and get relevant files, functions, and snippets.
- **Supporting Dual Views**: Physical (folder-based) for familiarity and Ontology (function-based) for conceptual understanding.
- **Reducing Hallucinations in AI Coding**: Provides targeted context for LLMs, improving accuracy in code generation or analysis tasks.
- **Offline-First Workflow**: Runs locally with optional cloud integration for team sharing.

Ktree is ideal for:
- Individual developers exploring open-source repos.
- Teams maintaining monorepos or microservices.
- AI integrations like retrieval-augmented generation (RAG) for code.

## Comparison with Similar Tools

Several open-source tools and research prototypes address codebase analysis and summarization, such as [PocketFlow](https://zacharyhuang.substack.com/p/ai-codebase-knowledge-builder-full) (which generates quick explanations and diagrams for repos), [Graphiti](https://github.com/getzep/graphiti) (focused on real-time knowledge graphs for AI agents), [Neo4j Codebase Knowledge Graph](https://neo4j.com/blog/developer/codebase-knowledge-graph/) (graph-based code analysis), and prototypes like CodeRAG or GitModel. Ktree complements these by emphasizing comprehensive structuring and retrieval:

- **Comprehensive Dual Trees**: While tools like PocketFlow provide explanatory guides and Neo4j focuses on graph representations, Ktree uniquely combines a physical hierarchy (directory-based) with a non-overlapping ontology (functional domains and subtopics), ensuring 100% code coverage.
- **Advanced Retrieval**: Unlike basic vector search in many tools, Ktree integrates dense embeddings for semantic search with sparse keyword matching (BM25/TF-IDF) and graph traversal, delivering precise, ontology-guided context to minimize noise.
- **Multi-Model Flexibility**: Supports configuring LLMs per task (e.g., Claude for summarization, Gemini for embeddings), offering more flexibility than single-model dependencies in tools like Graphiti.
- **Interactive Querying**: Provides a CLI and web UI for natural language queries with full-repo fallback, extending beyond the graph-building focus of Neo4j or the diagram-oriented approach of PocketFlow.
- **Feasibility for Large Repos**: Handles 400k+ LOC through chunking, parallelism, and caching, similar to scalable tools but optimized for offline runs in hours.
- **Open-Source and Extensible**: Uses a local SQLite backend for privacy with optional cloud mode, avoiding proprietary elements seen in some managed services.

## Installation

Since Ktree is not available in the main Homebrew repository, you need to tap the custom repository first. This adds the formula from the ktree GitHub repo to your Homebrew setup.

For the brew tap, I recommend naming it "homebrew-ktree" to follow Homebrew's common convention (e.g., similar to "homebrew-terraform" for other projects). This would be a separate repository under the Ktree-Dev organization: https://github.com/Ktree-Dev/homebrew-ktree, containing the Formula/ktree.rb file that points to the main ktree release artifacts (e.g., binaries or source tarballs from the main repo).

```bash
brew tap ktree-dev/homebrew-ktree https://github.com/Ktree-Dev/homebrew-ktree.git
brew install ktree
```

For development or alternative installs:
- Clone the repo: `git clone https://github.com/Ktree-Dev/ktree.git`
- Install dependencies: `npm install` (for the Next.js UI) or `pip install -r requirements.txt` (for Python components).
- Build: Follow instructions in [CONTRIBUTING.md](#contributing).

Note: If the tap name or URL changes, update accordingly. Tapping once is sufficient; subsequent installs or updates will use the tapped formula. If you encounter issues like "Error: No formulae found in tap," ensure the repo contains a valid Formula/ktree.rb file.

## Usage

1. **Initialize Configuration**:
   ```bash
   ktree init
   ```
   - Enter LLM API keys (e.g., Anthropic, OpenAI).
   - Select models for summarization, embeddings, and ontology.
   - Optional: Add Ktree cloud API key for managed storage.

2. **Run Analysis on a Repo**:
   ```bash
   ktree run /path/to/your/repo
   ```
   - Builds knowledge trees and stores in local SQLite (or cloud).
   - Progress logs show file summarization, tree construction, etc.

3. **Query the Knowledge Base**:
   ```bash
   ktree query "What is this repo about?"
   ```
   - Or for context: `ktree context "Fix login bug not showing errors"`.
   - Outputs relevant summaries, files, and snippets.

4. **Launch Web UI**:
   ```bash
   ktree ui
   ```
   - Browse physical/ontology trees, view summaries, and search semantically.

For more commands: `ktree --help`.

## Features

Ktree offers a rich set of features to enhance codebase understanding:

- **File Summarization**: AI-generated titles, concise summaries, and detailed function/class extractions with signatures, roles, and line ranges for precise navigation.
- **Physical Tree**: Mirrors the repository's directory structure with aggregated metrics like total LOC, file counts, and high-level directory summaries.
- **Ontology Tree**: Organizes code into functional domains (e.g., "Authentication > Login UI") with subtopics, ensuring complete coverage and logical grouping.
- **Semantic Search**: Supports natural language queries via embedding-based retrieval, enhanced with hybrid dense-sparse techniques for accurate results.
- **Context Assembly**: Delivers grouped, ranked outputs including code snippets, summaries, and topic overviews, ideal for LLM prompting or debugging.
- **Error Handling and Robustness**: Includes retries for LLM calls, fallbacks for low-similarity matches, and logging to ensure reliable processing.
- **Incremental Updates**: Efficiently re-analyzes only changed files on subsequent runs, saving time for evolving repositories.
- **Hybrid Retrieval Enhancements**: Combines semantic embeddings with keyword scoring and optional graph traversal for connected components.
- **Configurable Workflows**: Multi-LLM support, tunable parameters (e.g., similarity thresholds, MMR for diversity), and local/cloud modes for flexibility.
- **Hallucination Mitigation**: Grounds responses in traceable ground-truth snippets from the codebase, with metadata for sources and lines.

## License

Ktree is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Contributing

We welcome contributions to make Ktree even better! Whether it's bug fixes, new features, or docs improvements.

1. Fork the repo and create a branch: `git checkout -b feature/your-feature`.
2. Commit changes: Follow [Conventional Commits](https://www.conventionalcommits.org/).
3. Open a Pull Request: Describe the change, reference issues, and add tests if applicable.
4. Code Style: Use Prettier/ESLint for JS, Black for Python.

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines, setup, and code of conduct.

Report issues or suggest features via [GitHub Issues](https://github.com/Ktree-Dev/ktree/issues).

## Keywords for Search

codebase knowledge tree, repository summarization, ontology for code, semantic code search, AI codebase mapping, LLM code analysis, Git repo explorer, functional code domains, vector embeddings for code, hybrid retrieval BM25 embeddings.