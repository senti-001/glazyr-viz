---
description: Build the Neural-Chromium Browser
---

1. Navigate to src
   cd src

// turbo
2. Run Autoninja
   $env:GYP_MSVS_OVERRIDE_PATH="C:\Program Files\Microsoft Visual Studio\18\Community"; $env:DEPOT_TOOLS_WIN_TOOLCHAIN=0; c:\operation-greenfield\depot_tools\autoninja.bat -C out/AgentDebug chrome
