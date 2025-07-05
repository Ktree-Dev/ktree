class Ktree < Formula
  desc "Ktree CLI - Interactive LLM-powered code analysis and knowledge extraction"
  homepage "https://github.com/kaspermeilgaard/ktree"
  url "https://github.com/kaspermeilgaard/ktree/archive/v0.1.0.tar.gz"
  sha256 "PLACEHOLDER_SHA256"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "ci", "--production", "--ignore-scripts", "--workspace", "@ktree/cli"
    system "npm", "run", "build", "--workspace", "@ktree/cli"
    
    libexec.install Dir["*"]
    
    # Create wrapper script
    (bin/"ktree").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@20"].opt_bin}/node" "#{libexec}/packages/cli/dist/index.js" "$@"
    EOS
  end

  test do
    assert_match "ktree", shell_output("#{bin}/ktree --help")
    assert_match version.to_s, shell_output("#{bin}/ktree --version")
  end

  def caveats
    <<~EOS
      Run 'ktree init' to configure your API keys and model preferences.
      
      Configuration will be stored in ~/.ktree/config.json with encrypted secrets.
      
      For more information, visit: https://github.com/kaspermeilgaard/ktree
    EOS
  end
end
