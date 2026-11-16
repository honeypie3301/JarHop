# JarHop

JarHop is a local-first Windows app for porting Minecraft Java mods. Import the original JARs, choose a supported Minecraft version, and follow the build in your browser. When the build finishes, download the individual JARs, a ZIP bundle, or a manifest with the build and verification results.

## Get started

1. Start JarHop with [start.bat](start.bat).
2. Leave **From uploaded JAR** selected. Choose your NeoForge 1.21.1 source mod. Use **Add dependency JARs** to attach already-updated NeoForge libraries whose Minecraft compatibility range includes 26.1.2.
3. Select **26.1.2** and click **Build port**. JarHop remaps and decompiles the upload, reconstructs a Gradle project, and tries to build it against NeoForge 26.1.2.
4. Download the editable project and migration log if the build needs work. JarHop boots the packaged upload build with its dependencies in a fresh local NeoForge server before offering a candidate JAR and manifest. If startup fails, download the server verification log.

The upload path updates Minecraft and NeoForge metadata and applies shared Java API renames. Local uploads have no fixed compressed-file size cap. Archive validation, available memory, and ZIP format constraints still apply. Game API changes may need edits to the generated Java and resources. Server startup verifies mod discovery and loading. Client startup, gameplay, save compatibility, and visuals still require in-game checks.

Use **Prepared project** for the bundled Viltrumite build or an optional custom build profile. Online builds still use the prepared path.

## Setup and deployment

The [setup guide](docs/SETUP.md) covers Windows prerequisites, local tool paths, and the optional GitHub Actions runner. Use [build.bat](build.bat) to rebuild JarHop and run its tests.
