{
  description = "Development environment for the Nostr Hierarchical List Manager (SvelteKit)";

  # Flake inputs: nixpkgs for packages, flake-utils for multi-system support
  inputs = {
    # Using nixos-unstable for potentially newer Node versions, pin if needed for strict reproducibility
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  # Flake outputs
  outputs = { self, nixpkgs, flake-utils }:
    # Use flake-utils to generate outputs for common systems (linux/macos, x86/arm)
    flake-utils.lib.eachDefaultSystem (system:
      let
        # Import nixpkgs for the specific system
        pkgs = import nixpkgs { inherit system; };

        # --- Configuration ---
        # Choose Node.js major version (LTS versions like 20 or 22 are good choices for 2025)
        nodejsMajorVersion = 22;
        # Choose your preferred Node.js package manager
        # pnpm is recommended for efficiency
        packageManager = pkgs.pnpm;
        # To use yarn: packageManager = pkgs.yarn;
        # To use npm (included with nodejs): Add pkgs.nodejs below, npm is implicit

        # List of packages needed in the development environment
        devPackages = with pkgs; [
          # Node.js runtime (select specific major version)
          # Node.js runtime (select specific major version)
          pkgs."nodejs_${toString nodejsMajorVersion}" # Correct syntax

          # Node.js package manager
          # Node.js package manager
          packageManager

          # Git for version control
          git

          # Optional: For formatting this flake.nix file
          nixpkgs-fmt
        ];

      in
      {
        # Development shell environment invoked with `nix develop`
        devShells.default = pkgs.mkShell {
          # Packages available in the shell
          packages = devPackages;

          # Optional: Commands to run when entering the shell
          # Uncomment and customize if needed
          # shellHook = ''
          #   export NODE_ENV=development
          #   echo "--- Nostr List Manager Dev Environment ---"
          #   echo "Node $(node --version), PNPM $(pnpm --version)"
          #   # Check if node_modules exists, prompt to install if not
          #   if [ ! -d "node_modules" ]; then
          #     echo "Node modules not found. Run 'pnpm install'."
          #   else
          #     echo "Run 'pnpm dev' to start the dev server."
          #   fi
          #   echo "-----------------------------------------"
          # '';
        };

        # Formatter for `nix fmt` command (optional)
        formatter = pkgs.nixpkgs-fmt;
      });
}
