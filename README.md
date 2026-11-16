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

## Update a port after an upstream release

Use [refresh.bat](refresh.bat) to merge a new upstream source snapshot into a copy of a working port and optionally compile it. [Refresh setup](docs/SETUP.md#refresh-an-existing-port)

### Viltrumite Core and Flight

For the known original 1.21.1 releases, use **Prepared project** and select Core and Flight. Laser Eyes is optional for local prepared builds. In **From uploaded JAR**, the dependency picker takes libraries already built for 26.1.2. The original 1.21.1 Flight JAR belongs in the prepared workflow.

Start JarHop from a terminal with npm start. Restart the local runner with npm run restart. Missing upload tools are installed when the next upload build needs them. The refresh workflow is still available through refresh.bat and its JSON configuration. Online jobs appear as a link once VITE_JARHOP_ONLINE_URL is configured.
