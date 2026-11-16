# JarHop setup

JarHop builds the supported Viltrumite trio for NeoForge 26.1.2. It accepts the original 1.21.1 Core 1.12.1, Flight 1.6.9, and Laser Eyes 1.3.3 binaries. The accepted SHA-256 hashes are in engine.mjs.

## Windows

Use Node.js 22 or later, Java 25 and the Codex workspace containing the Viltrumite port and Gradle cache. Run build.bat, then start.bat. Run stop.bat to stop the local service. The service accepts jobs only at http://127.0.0.1:4789. It keeps job inputs, diagnostics, candidate JARs and the editable Gradle project in .jarhop, which is gitignored.

The default configuration finds the sources and tools in Documents/MCreator/Codex and Java in JAVA_HOME or .jdks/openjdk-25.0.1. Set JARHOP_CODEX to relocate the cache and template. For an independent setup, create a tools.local.json file with absolute paths for java, art, mappings, minecraft, vineflower and template. Set env.JAVA_HOME and env.GRADLE_USER_HOME there when using a separate cache. The supported tools are ART 2.0.17, official 1.21.1 Mojang mappings and client JAR, Vineflower 1.11.2, and the Gradle 9.6.1 wrapper. The template must be the existing 26.1.2.95 Viltrumite Gradle port, including its GeckoLib library. Set offline to false to allow Gradle to populate a clean cache.

JarHop remaps and decompiles imported binaries for inspection. It builds from the existing checked source port matched to those exact original binaries. The decompiler output is available in each job directory for analysis. Arbitrary automatic migration, symbol completeness and behavioral equivalence are pending. Exports are always marked candidate.

## Online setup

Deploy the frontend to GitHub Pages or Vercel. Set the Pages repository variable JARHOP_ONLINE_URL to the Vercel origin to link it from Pages. Configure Vercel with JARHOP_ORIGIN, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, JARHOP_SESSION_SECRET, JARHOP_OPERATORS (comma-separated GitHub logins), JARHOP_WORKER_REPO (owner/repo), JARHOP_WORKER_TOKEN with Actions write access to that private repository, and a private Vercel Blob store. Register the OAuth callback as /api/online?action=callback on the Vercel origin. Set JARHOP_WORKER_REF if the worker branch differs from main.

Place the worker workflow and JarHop source in that private repository. Give its operators repository access to download workflow artifacts. Add BLOB_READ_WRITE_TOKEN as a repository secret. Set JARHOP_WORKER_IMAGE to an immutable image digest from a registry the workflow can pull. The image needs Node.js 22, Java 25, the configured template and tools, and a warmed Gradle cache. Set JARHOP_JAVA, JARHOP_ART, JARHOP_VINEFLOWER, JARHOP_MAPPINGS, JARHOP_MINECRAFT, JARHOP_TEMPLATE and JARHOP_GRADLE_CACHE inside that image. The worker copies the warmed cache to its writable job directory and runs offline. Check registry access and upload cleanup with a private test job before enabling online use.

## Verification

Run npm test for archive validation, metadata extraction and version gating. The output manifest reports asset differences, source prerequisites and verification gaps. The clean-install client/server parity suite is still pending, including damage and cooldowns, flight, Laser Eyes, NPCs, save/reload, HUD and skin layers.

## Add a local build profile

For a mod you have a migrated Gradle project for, create `port-profiles.local.json` next to `start.bat`. This example registers a single NeoForge mod for 26.2.

```json
[
  {
    "id": "example-26-2",
    "title": "Example mod",
    "target": "26.2",
    "template": "C:/Mods/Example-26.2",
    "inputs": [
      {
        "id": "examplemod",
        "version": "1.0.0",
        "sha256": "replace-with-the-lowercase-sha256-of-the-original-jar",
        "artifact": "build/libs/examplemod-1.0.0.jar"
      }
    ]
  }
]
```

Use PowerShell `Get-FileHash .\original.jar` to find the original JAR's SHA-256 and enter it in lowercase. Set `template` to a trusted Gradle project with its own wrapper and the completed target-version migration. The output JAR must declare the same mod ID and version as the input, with the selected Minecraft version as the lower bound of its declared Minecraft dependency. The project must use the configured Java toolchain and have its dependencies available in the Gradle cache, or set `offline` to `false` in `tools.local.json`.

Refresh JarHop, select the original JAR and the profile's target version, then click **Build port**. One profile can export up to three JARs. The local runner executes the trusted project's Gradle build and compares the results to the original files. Exports remain candidates. Porting an arbitrary JAR still requires preparing the target project and testing the resulting mod in Minecraft.

## Verify behavior

Local upload builds boot a fresh NeoForge dedicated server and launch a disposable test client. JarHop closes the client after it reaches the title screen. A build with both startup checks passed is a **Candidate** until a behavior suite passes.

Register a trusted Node.js test script in `tools.local.json` under `verificationSuites`, keyed by `<original SHA-256>:26.1.2`. JarHop calls the script with two arguments, a request JSON path and a result JSON path. The request contains both JAR paths and hashes, the source and target versions, the NeoForge version and target dependencies. The script runs the original and the candidate and writes `originalSha256`, `candidateSha256`, and `cases`. Each case needs a descriptive `name`, a `category` of `gameplay`, `save-reload`, `multiplayer`, or `visuals`, and `original` and `candidate` outcomes. Each category must be covered and every outcome must be `passed` for the exact JAR to be labeled **Verified**. The manifest records these scenarios. The original mod runtime and any original-version dependencies that the suite needs must be supplied by the suite.
