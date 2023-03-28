import BumperOptionsFile, { BumpRule, RuleTrigger, VersionFile } from "../lib/types/OptionsFile.types";
import * as definedSchemes from "../schemes.json";
import BumperState from "../lib/types/BumperState.type";
import { bumpVersion, getCurVersion, getSchemeRegex, getTag } from "./utils";

import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from "fs";

/**
 * Normalizes options by associating the scheme if user has selected a preset scheme
 * @param options
 */
export function normalizeOptions(options: BumperOptionsFile) {
  try {
    options.schemeDefinition = getSchemeDefinition(options);
  } catch (e: any) {
    console.error(e.message);
    throw e; // rethrow to stop process
  }
}

/**
 * Gets the scheme definitions from the Bumper Options
 * @param options
 */
export function getSchemeDefinition(options: BumperOptionsFile): string {
  let definedSchemesNames = Object.keys(definedSchemes);
  // verify that its not custom and preset
  if (options.scheme !== "custom" && definedSchemesNames.indexOf(options.scheme) !== -1)
    return definedSchemes[options.scheme];
  // Throw error if scheme is not defined
  else if (options.scheme !== "custom" && definedSchemesNames.indexOf(options.scheme) === -1) {
    throw new Error(`Scheme ${options.scheme} is not defined.`);
  } else if (options.scheme === "custom" && (!options.schemeDefinition || options.schemeDefinition.trim() === "")) {
    throw new Error(`Custom scheme has no definition. Scheme Definition must be specified in options`);
  } else if (!options.schemeDefinition || options.schemeDefinition.trim() === "") {
    throw new Error(`Custom scheme has no definition. Scheme Definition must be specified in options`);
  } else {
    return options.schemeDefinition;
  }
}

/**
 * Get Branch name from reference
 * Only tested with the GITHUB_REF env var
 * @param trigger
 */
export function getBranchFromTrigger(trigger: RuleTrigger): string {
  let branch: string;
  switch (trigger) {
    case 'pull-request':
      branch = process.env.GITHUB_HEAD_REF || '';
      break;
    case 'commit':
    case 'manual':
    default:
      branch = process.env.GITHUB_REF?.substring('refs/heads/'.length) || '';
      break;
  }
  core.info(`Current Branch identified: ${branch}`);
  return branch;  
}

/**
 * Get the destination branch for an action,
 * this is principally used for pull requests to match head and base refs
 * @param trigger {RuleTrigger}
 * @returns {string}
 */
export function getDestBranchFromTrigger(trigger: RuleTrigger): string {
  let branch: string;
  switch (trigger) {
    case 'pull-request':
      branch = process.env.GITHUB_BASE_REF || '';
      break;
    case 'commit':
    case 'manual':
    default:
      branch = process.env.GITHUB_REF?.substring('refs/heads/'.length) || '';
      break;
  }
  core.info(`Current Dest Branch identified: ${branch}`);
  return branch;
}

/**
 * Get all bumper options
 */
export async function getBumperOptions(): Promise<BumperOptionsFile> {
  const optionsFile = core.getInput('options-file');
  const scheme = core.getInput('scheme');
  const skip = core.getInput('skip');
  const customScheme = core.getInput('custom-scheme');
  const versionFile = core.getInput('version-file');
  const files = core.getInput('files');
  const rules = core.getInput('rules');
  const username = core.getInput('username');
  const email = core.getInput('email');

  let error = ""; // error message
  let bumperOptions: any = {};
  let err = (message: string) => {
    console.error(message);
    error += message + '\n';
  };

  if (optionsFile && !fs.existsSync(optionsFile)) {
    console.warn(`Options file with path ${optionsFile} does not exist`);
    // error += `Options file with path ${optionsFile} does not exist\n`;
  } else if (optionsFile && fs.existsSync(optionsFile)) {
    try {
      bumperOptions = JSON.parse(await fs.readFileSync(optionsFile, { encoding: 'utf8', flag: 'r' }));
    } catch (e) {
      console.warn(`Error reading or parsing bumper options file with path ${optionsFile}\n${e}`);
    }
  }

  if (scheme) bumperOptions.scheme = scheme;
  else if (!scheme && (!bumperOptions.hasOwnProperty('scheme')
    || !bumperOptions.scheme
    || (bumperOptions.scheme as string).trim() === "")) {
    err("Scheme is not defined in option file or workflow input.");
  }

  if (customScheme && customScheme.trim() !== "") {
    bumperOptions.scheme = "custom";
    bumperOptions.schemeDefinition = customScheme;
  }
  try {
    bumperOptions.schemeDefinition = getSchemeDefinition(bumperOptions);
  } catch (e: any) {
    err(e);
  }

  if (versionFile && versionFile.trim() !== '') {
    try {
      bumperOptions.versionFile = JSON.parse(versionFile);
    } catch (e) {
      // console.log(e.message);
      bumperOptions.versionFile = { path: versionFile };
    }
  } else if (!bumperOptions.hasOwnProperty('versionFile')
    || !bumperOptions.versionFile
    || (bumperOptions.versionFile as string).trim() === "") {
    err("Version file is not defined in option file or workflow input.");
  } else {
    bumperOptions.versionFile = normalizeFiles([bumperOptions.versionFile])[0];
  }

  if (files && files.trim() !== '') {
    try {
      const filesArray = JSON.parse(files);
      if (!Array.isArray(filesArray)) {
        err("Files should be in array stringified JSON format");
      } else bumperOptions.files = normalizeFiles([bumperOptions.versionFile, ...filesArray]);
    } catch (e) {
      err("Files not in JSON format");
    }
  } else if (!bumperOptions.hasOwnProperty('files')
    || !bumperOptions.files
    || !Array.isArray(bumperOptions.files)) {
    err("Files are not defined in option file or workflow input.");
  } else bumperOptions.files = normalizeFiles([bumperOptions.versionFile, ...bumperOptions.files]);

  if (rules && rules.trim() !== '') {
    try {
      const rulesArray = JSON.parse(rules);
      if (!Array.isArray(rulesArray)) {
        err("Rules should be in array stringified JSON format");
      } else bumperOptions.rules = rulesArray as BumpRule[];
    } catch (e) {
      err("Rules not in JSON format");
    }
  } else if (!bumperOptions.hasOwnProperty('rules')
    || !bumperOptions.rules
    || !Array.isArray(bumperOptions.rules)) {
    err("Rules are not defined in option file or workflow input.");
  }

  if (skip) bumperOptions.skip = skip;
  if (username) bumperOptions.username = username;
  if (email) bumperOptions.email = email;

  if (error !== "") throw new Error(error);
  else {
    console.log(JSON.stringify(bumperOptions));
    return bumperOptions as BumperOptionsFile;
  }
}

/**
 * Get the version files in a consistent format
 * @param options {VersionFile[]}
 */
export function getFiles(options: BumperOptionsFile): VersionFile[] {
  return normalizeFiles(options.files);
}

/**
 * Check if should add [SKIP] prefix
 * @param options {skip}
 */
export function getSkipOption(options: BumperOptionsFile): boolean {
  return options.skip || false;
}

/**
 * Normalize the file format
 * @param files
 */
export function normalizeFiles(files: (VersionFile | string)[]): VersionFile[] {
  let filez = {};
  for (let file of files) {
    if (typeof file === 'object')  // VersionFile
      filez[(file as VersionFile).path] = (file as VersionFile).line;
    else
      filez[file] = undefined;
  }
  return Object.keys(filez).reduce((pre: VersionFile[], cur: string) => [...pre,
  filez[cur] ? { path: cur, line: filez[cur] } : { path: cur }], []);
}

/**
 * Gets the trigger event.
 * Valid trigger events:
 *  - push: [created]
 *  - pull_request: any
 *  - pull_request_review_comment: any
 *  - workflow_dispatch: any
 */
export function getTrigger(): RuleTrigger {
  let { eventName, payload } = github.context;
  const payload_action = payload.action;
  console.info(`Trigger -> ${eventName} - ${payload_action}`);
  switch (eventName) {
    case 'push':
      return 'commit';
    case 'pull_request':
      if (payload_action === "opened") return 'pull-request';
      if (payload_action === "synchronize") return 'pull-request-sync';
      return 'pull-request-other';
    // case 'pull_request_review_comment':
    //   return 'pr-comment';
    case 'workflow_dispatch':
      return 'manual';
    default:
      console.warn("Event trigger not of type: commit, pull request or manual.");
      throw new Error("Invalid trigger event");
  }
}

/**
 * Get state variables
 * @param options
 */
export async function getBumperState(options: BumperOptionsFile): Promise<BumperState> {
  const trigger: RuleTrigger = getTrigger(),
    branch = getBranchFromTrigger(trigger),
    destBranch = getDestBranchFromTrigger(trigger),
    skip = getSkipOption(options),
    schemeRegExp = getSchemeRegex(options),
    schemeDefinition = getSchemeDefinition(options),
    curVersion = await getCurVersion(options),
    curAppVersion = await getCurVersion({...options, versionFile: {path: options.versionFile.path}}),
    tag: boolean = getTag(options, trigger, branch, destBranch),
    newVersion = await bumpVersion(options, trigger, branch, destBranch),
    files = getFiles(options);
  const state = {
    curVersion,
    newVersion,
    skip,
    schemeRegExp,
    schemeDefinition,
    tag,
    trigger,
    branch,
    destBranch,
    files,
    curAppVersion
  };
  core.info(`State -> ${JSON.stringify(state)}`);
  return state;
}
