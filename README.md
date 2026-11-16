# JarHop

JarHop is a local-first Windows app for porting Minecraft Java mods. Import the original JARs, choose a supported Minecraft version, and follow the build in your browser. When the build finishes, download the individual JARs, a ZIP bundle, or a manifest with the build and verification results.

## Get started

1. Double-click [start.bat](start.bat). JarHop opens in your browser at `http://127.0.0.1:4789`.
2. Select the original NeoForge 1.21.1 JARs for **Viltrumite Core 1.12.1**, **Viltrumite Flight 1.6.9**, and **Laser Eyes 1.3.3**.
3. Choose **26.1.2** and click **Build port**.
4. Download the build from the results panel. Use [stop.bat](stop.bat) when you want to shut down JarHop.

Local builds keep your files on your PC. The app saves each job's logs, editable project, and exports inside `.jarhop`. If a build fails, open **Build log** to see which step failed.

## Supported ports

The local runner can inspect NeoForge, Forge, Fabric and Quilt JARs. The bundled profile is the original Viltrumite trio on **NeoForge 1.21.1 → 26.1.2**. Local profiles can build other mods and newer versions from a prepared Gradle migration project. See [Add a local build profile](docs/SETUP.md#add-a-local-build-profile). It remaps and decompiles the original JARs for inspection, then builds from the existing port source matched to those binaries. Exports are marked **Candidate** while full in-game behavior checks are pending.

## Setup and deployment

The [setup guide](docs/SETUP.md) covers Windows prerequisites, local tool paths, and the optional GitHub Actions runner. Use [build.bat](build.bat) to rebuild JarHop and run its tests.
