# JarHop

JarHop is a local-first Windows app for porting Minecraft Java mods. Import the original JARs, choose a supported Minecraft version, and follow the build in your browser. When the build finishes, download the individual JARs, a ZIP bundle, or a manifest with the build and verification results.

## Get started

1. Start JarHop with [start.bat](start.bat).
2. Leave **From uploaded JAR** selected. Add a NeoForge 1.21.1 mod first, followed by any required dependency JARs that declare 26.1.2 support.
3. Select **26.1.2** and click **Build port**. JarHop remaps and decompiles the upload, reconstructs a Gradle project, and tries to build it against NeoForge 26.1.2.
4. Download the editable project and migration log if the build needs work. A successful build adds a candidate JAR and manifest.

The upload path updates Minecraft and NeoForge metadata and renames Minecraft ResourceLocation type references to Identifier. Game API changes may need edits to the generated Java and resources. Logic and visuals require in-game checks.

Use **Prepared project** for the bundled Viltrumite build or an optional custom build profile. Online builds still use the prepared path.

## Setup and deployment

The [setup guide](docs/SETUP.md) covers Windows prerequisites, local tool paths, and the optional GitHub Actions runner. Use [build.bat](build.bat) to rebuild JarHop and run its tests.
