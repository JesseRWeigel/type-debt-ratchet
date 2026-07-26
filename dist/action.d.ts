#!/usr/bin/env node
/**
 * GitHub Action entry point.
 *
 * Deliberately does not depend on @actions/core or @actions/github. The runner contract is
 * a handful of environment variables and two append-only files, which is less code to own
 * than a bundler configuration and a committed vendor tree.
 */
import { type RatchetOptions } from "./run.ts";
type Env = NodeJS.ProcessEnv;
/** Read an `inputs:` value. The runner exposes them as INPUT_<NAME>, spaces become _. */
export declare function input(env: Env, name: string): string;
/** GitHub's own boolean input convention: only the exact string "true" is true. */
export declare function booleanInput(env: Env, name: string, fallback: boolean): boolean;
/** Translate the action's inputs into ratchet options. Exported so tests can assert it. */
export declare function optionsFromEnv(env: Env): RatchetOptions;
export declare function run(env?: Env): Promise<number>;
export {};
