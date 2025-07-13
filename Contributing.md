# Contributing to Ktree

Thank you for your interest in contributing to Ktree! We welcome contributions from the community to help improve the project. Whether you're fixing bugs, adding features, improving documentation, or suggesting enhancements, your input is valuable.

## Getting Started

1. **Fork the Repository**: Click the "Fork" button at the top right of the [Ktree repository](https://github.com/Ktree-Dev/ktree) to create your own copy.

2. **Clone Your Fork**: Clone the forked repository to your local machine:
   ```
   git clone https://github.com/YOUR-USERNAME/ktree.git
   cd ktree
   ```

3. **Set Up Development Environment**:
   - Install dependencies based on the components you're working on:
     - For the Next.js UI: `npm install`
     - For Python components: `pip install -r requirements.txt` (if applicable; ensure you have Python 3.12+).
   - Configure LLM API keys for testing: Run `ktree init` and follow the prompts (use test keys or mocks for development).
   - If working on the Homebrew formula, see the [homebrew-ktree repo](https://github.com/Ktree-Dev/homebrew-ktree) for tap-specific instructions.

4. **Create a Branch**: Create a new branch for your changes:
   ```
   git checkout -b feature/your-feature-name
   ```
   Use descriptive names like `fix/bug-description` or `feat/new-feature`.

## Making Changes

- **Code Style**:
  - JavaScript/TypeScript: Use Prettier and ESLint. Run `npm run lint` and `npm run format` before committing.
  - Python: Use Black for formatting and Flake8 for linting. Run `black .` and `flake8` in the project root.
  - Follow consistent naming conventions (camelCase for JS, snake_case for Python).

- **Commit Guidelines**: Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for clear history:
  - `feat: add new ontology traversal feature`
  - `fix: resolve embedding index error in large repos`
  - `docs: update README with new installation steps`
  - Include a brief description in the commit body if needed.

- **Testing**:
  - Write unit tests for new features or bug fixes (using Jest for JS, pytest for Python).
  - Test locally: Run `ktree run` on a sample repo and verify outputs.
  - Ensure no breaking changes to existing functionality.

- **Documentation**: Update relevant docs (e.g., README.md, inline comments) for your changes.

## Submitting Your Contribution

1. **Push Your Branch**:
   ```
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request (PR)**:
   - Go to the original [Ktree repository](https://github.com/Ktree-Dev/ktree) and click "New Pull Request".
   - Select your branch and provide a clear title/description:
     - What does this PR do?
     - Reference any related issues (e.g., "Fixes #123").
     - Include screenshots for UI changes.
   - Ensure the PR passes any CI checks (if set up).

3. **Code Review**: Maintainers will review your PR. Be responsive to feedback and make updates as needed.

## Code of Conduct

We expect all contributors to adhere to a respectful and inclusive environment. Harassment or inappropriate behavior will not be tolerated. Report issues to the maintainers.

## Questions?

If you have questions, open an issue with the "question" label or reach out via discussions on GitHub.

Thanks for contributing to Ktree – let's make codebase exploration even better!