import { deployProcesses } from '../deployProcesses.mjs';

export const applyCommand = async (options) => {
  try {
    await deployProcesses(options);
  } catch (err) {
    console.error('Error deploying processes:', err);
  }
};