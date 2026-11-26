{
  description = "Burner - GRBL laser sender (browser UI + stdlib Python serial bridge)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      packages = forAll (pkgs: rec {
        burner = pkgs.stdenvNoCC.mkDerivation {
          pname = "burner";
          version = "0.2.0";
          src = self;
          nativeBuildInputs = [ pkgs.makeWrapper ];
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out/share/burner $out/bin
            cp -r burner_bridge.py web $out/share/burner/
            makeWrapper ${pkgs.python3}/bin/python3 $out/bin/burner \
              --add-flags $out/share/burner/burner_bridge.py \
              --add-flags --open
            makeWrapper ${pkgs.python3}/bin/python3 $out/bin/burner-bridge \
              --add-flags $out/share/burner/burner_bridge.py
            runHook postInstall
          '';
          meta = {
            description = "GRBL laser sender with a browser UI";
            mainProgram = "burner";
            platforms = pkgs.lib.platforms.unix;
          };
        };
        default = burner;
      });

      apps = forAll (pkgs: {
        default = { type = "app"; program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.burner}/bin/burner"; };
      });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell { packages = [ pkgs.python3 pkgs.nodejs ]; };
      });

      # NixOS: imports = [ burner.nixosModules.default ];
      #        programs.burner = { enable = true; user = "you"; };
      nixosModules.default = { config, lib, pkgs, ... }:
        let cfg = config.programs.burner; in {
          options.programs.burner = {
            enable = lib.mkEnableOption "Burner GRBL laser sender";
            user = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "User to add to the dialout group so the bridge can open the laser's serial port.";
            };
          };
          config = lib.mkIf cfg.enable {
            environment.systemPackages = [ self.packages.${pkgs.stdenv.hostPlatform.system}.burner ];
            users.users = lib.mkIf (cfg.user != null) {
              ${cfg.user}.extraGroups = [ "dialout" ];
            };
          };
        };
    };
}
