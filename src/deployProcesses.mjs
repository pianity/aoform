import dotenv from "dotenv";
dotenv.config();

console.log("aoform v1.3");

import yaml from "js-yaml";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { connect, createDataItemSigner } from "@permaweb/ao-connect";

// Connect to the AO network
const ao = connect({
  CU_URL: "http://localhost:4004",
  GATEWAY_URL: "http://localhost:4000",
  GRAPHQL_URL: "http://localhost:4000/graphql",
  MU_URL: "http://localhost:4002",
});

console.log("AO connection details: ", ao);

// Load the YAML file
const processesYamlPath = path.join(process.cwd(), "processes.yaml");
let processes = [];
try {
  console.log("Reading processes.yaml from: ", processesYamlPath);
  const processesYaml = fs.readFileSync(processesYamlPath, "utf8");
  processes = yaml.load(processesYaml);
  console.log("Loaded processes: ", processes);
} catch (err) {
  if (err.code !== "ENOENT") {
    console.error("Error reading processes.yaml: ", err);
    throw err;
  }
  console.warn(
    "processes.yaml file not found. No processes will be deployed or updated."
  );
}

// Load the state file or create a new one
let state;
try {
  const stateYamlPath = path.join(process.cwd(), "state.yaml");
  console.log("Reading state.yaml from: ", stateYamlPath);
  const stateYaml = fs.readFileSync(stateYamlPath, "utf8");
  state = yaml.load(stateYaml);
  console.log("Loaded state: ", state);
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("state.yaml not found. Initializing empty state.");
    state = {};
  } else {
    console.error("Error reading state.yaml: ", err);
    throw err;
  }
}

// Function to get the hash of a file
function getFileHash(filePath) {
  console.log("Calculating hash for file: ", filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  const hash = hashSum.digest("hex");
  console.log("File hash: ", hash);
  return hash;
}

// Function to deploy a process
async function deployProcess(processInfo) {
  const name = processInfo.name;
  const filePath = processInfo.file;
  const tags = processInfo.tags || [];
  const currentHash = getFileHash(filePath);
  const prerunFilePath = processInfo.prerun || ""; // Get the prerun file path, or an empty string if not provided

  console.log("Deploying process: ", name);
  console.log("Process info: ", processInfo);

  // Check if the process has already been deployed
  if (state[name]) {
    const processState = state[name];
    const lastHash = processState.hash;

    if (lastHash === currentHash) {
      console.log(`Process '${name}' is up-to-date.`);
      return;
    }
  }

  // Load the Lua file
  console.log("Loading main script from: ", filePath);
  const mainScript = fs.readFileSync(filePath, "utf8");

  // Load the prerun script, if provided
  let prerunScript = "";
  if (prerunFilePath) {
    console.log("Loading prerun script from: ", prerunFilePath);
    prerunScript = fs.readFileSync(prerunFilePath, "utf8");
  }

  // Concatenate the prerun script with the main script
  const luaCode = `${prerunScript}\n${mainScript}`;

  if (!process.env.WALLET_JSON) {
    console.error(
      "Missing WALLET_JSON environment variable. Please provide the wallet JSON in the environment variable WALLET_JSON."
    );
    process.exit(1);
  }

  let processId;
  const wallet = JSON.parse(process.env.WALLET_JSON); // Read wallet from environment variable
  const signer = createDataItemSigner(wallet);

  console.log("Wallet: ", wallet);
  console.log("Signer: ", signer);
  console.log("Spawning process...", {
    module: processInfo.module,
    scheduler: processInfo.scheduler,
    signer,
    tags,
  });
  if (!state[name] || !state[name].processId) {
    let spawnAttempts = 0;
    const maxSpawnAttempts = 5;
    const spawnDelay = 30000; // 30 seconds

    while (spawnAttempts < maxSpawnAttempts) {
      try {
        processId = await ao.spawn({
          module: processInfo.module,
          scheduler: processInfo.scheduler,
          signer: createDataItemSigner(wallet),
          tags,
        });
        console.log("Spawned process:", processId);
        break;
      } catch (err) {
        spawnAttempts++;
        console.log("Error spawning process:", err);
        console.log(
          `Failed to spawn process '${name}'. Attempt ${spawnAttempts}/${maxSpawnAttempts}`
        );
        if (spawnAttempts === maxSpawnAttempts) {
          console.error("Error spawning process:", err);
          console.error(
            `Failed to spawn process '${name}' after ${maxSpawnAttempts} attempts.`
          );
          process.exit(1);
        } else {
          console.log(`Retrying in ${spawnDelay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, spawnDelay));
        }
      }
    }
  } else {
    processId = state[name].processId;
    console.log(
      `Using existing process ID '${processId}' for process '${name}'.`
    );
  }

  // Try sending the 'eval' action 5 times with a 30-second delay
  let attempts = 0;
  const maxAttempts = 5;
  const delay = 5000; // 5 seconds

  console.log("Sending code to process ID:", processId);
  while (attempts < maxAttempts) {
    try {
      const r = await ao.message({
        process: processId,
        data: luaCode,
        tags: [
          {
            name: "Action",
            value: "Eval",
          },
        ],
        signer,
      });
      console.log(`Successfully sent 'eval' action for process '${name}'.`);
      console.log("Response: ", r);
      break;
    } catch (err) {
      attempts++;
      console.error("Error sending 'eval' action:", err);

      console.log(
        `Failed to send 'eval' action for process '${name}'. Attempt ${attempts}/${maxAttempts}`
      );
      if (attempts === maxAttempts) {
        console.error(
          `Failed to send 'eval' action for process '${name}' after ${maxAttempts} attempts.`
        );
      } else {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Update the state
  console.log(`Updating state for process '${name}'`);
  state[name] = {
    processId,
    hash: currentHash,
  };
}

export async function deployProcesses() {
  console.log("Deploying processes...");
  // Deploy or update processes
  for (const processInfo of processes) {
    await deployProcess(processInfo);
  }

  // Save the updated state
  console.log("Saving updated state to state.yaml");
  const updatedState = yaml.dump(state);
  const stateYamlPath = path.join(process.cwd(), "state.yaml");
  fs.writeFileSync(stateYamlPath, updatedState, "utf8");
  console.log("Updated state saved successfully.");
}
