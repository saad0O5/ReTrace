const { spawn } = require("child_process");
const path = require("path");

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath], {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  console.log("\n============================================================");
  console.log("RETRACE FULL TEST SUITE (PHASE 0 + PHASE 1)");
  console.log("============================================================\n");

  try {
    console.log(">>> RUNNING PHASE 0 SUITE...");
    await runScript(path.join(__dirname, "phase0.test.js"));

    console.log("\n>>> RUNNING PHASE 1 SUITE...");
    await runScript(path.join(__dirname, "phase1.test.js"));

    console.log("\n>>> RUNNING PHASE 2 SUITE...");
    await runScript(path.join(__dirname, "phase2.test.js"));

    console.log("\n>>> RUNNING PHASE 3 SUITE...");
    await runScript(path.join(__dirname, "phase3.test.js"));

    console.log("\n>>> RUNNING PHASE 4 SUITE...");
    await runScript(path.join(__dirname, "phase4.test.js"));

    console.log("\n>>> RUNNING PIPELINE SUITE...");
    await runScript(path.join(__dirname, "pipeline.test.js"));

    console.log("\n============================================================");
    console.log("ALL TESTS COMPLETED SUCCESSFULLY: PHASE 0 + PHASE 1 + PHASE 2 + PHASE 3 + PHASE 4 + PIPELINE");
    console.log("============================================================\n");
  } catch (err) {
    console.error("\nTest suite failure:", err.message);
    process.exit(1);
  }
}

main();
