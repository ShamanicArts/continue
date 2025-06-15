// core/autocomplete/session/AutocompleteSessionManager.ts

import {
  CompletionProvider,
  ManualTriggerContext,
} from "../CompletionProvider.js";
import { AutocompleteInput, AutocompleteOutcome } from "../util/types.js";

/**
 * Manages the state of a multi-suggestion "reroll" session for autocomplete.
 *
 * This class is responsible for:
 * - Tracking the sequence of suggestions for a single completion point.
 * - Determining if a new request is a continuation of a session (a "reroll").
 * - Triggering the core CompletionProvider with the correct ManualTriggerContext.
 * - Caching the outcomes of the session to build a list for the user.
 */
export class AutocompleteSessionManager {
  /**
   * Stores the sequence of suggestions generated for the current session.
   * The last item in the array is the most recent suggestion.
   */
  private activeSession: AutocompleteOutcome[] = [];

  /**
   * Stores the input parameters of the last request. This is used to
   * determine if a new request is for the same logical completion.
   */
  private lastInput: AutocompleteInput | undefined;

  constructor(private readonly completionProvider: CompletionProvider) {}

  /**
   * Determines if a new autocomplete request should be treated as a
   * continuation of the current reroll session.
   *
   * @param input The input for the new autocomplete request.
   * @returns `true` if it's a continuation, `false` otherwise.
   */
  private isContinuation(input: AutocompleteInput): boolean {
    if (!this.lastInput) {
      console.log("[isContinuation] FAILED: lastInput is missing.");
      return false;
    }

    const isSameFile = this.lastInput.filepath === input.filepath;
    const isSameLine = this.lastInput.pos.line === input.pos.line;
    const isCloseCharacter =
      Math.abs(this.lastInput.pos.character - input.pos.character) <= 1;

    if (!isSameFile) {
      console.log(
        `[isContinuation] FAILED: Filepath mismatch. Last: ${this.lastInput.filepath}, Current: ${input.filepath}`,
      );
    }
    if (!isSameLine) {
      console.log(
        `[isContinuation] FAILED: Line mismatch. Last: ${this.lastInput.pos.line}, Current: ${input.pos.line}`,
      );
    }
    if (!isCloseCharacter) {
      console.log(
        `[isContinuation] FAILED: Character mismatch. Last: ${this.lastInput.pos.character}, Current: ${input.pos.character}`,
      );
    }

    return isSameFile && isSameLine && isCloseCharacter;
  }

  /**
   * Clears the current reroll session. This must be called whenever the
   * user's context changes in a way that invalidates the previous suggestions
   * (e.g., typing, moving the cursor, switching files).
   */
  public clearSession(): void {
    console.log(
      "[SessionManager] clearSession() was called.",
      new Error().stack,
    );
    this.activeSession = [];
    this.lastInput = undefined;
  }

  /**
   * The main entry point for getting a completion. It either starts a new
   * session or continues an existing one by generating a "reroll".
   *
   * @param input The input for the autocomplete request.
   * @param token An AbortSignal to cancel the request.
   * @returns A promise that resolves to an array of all suggestions in the
   *          current session, including the newly generated one.
   */
  public async getNextCompletion(
    input: AutocompleteInput,
    token: AbortSignal,
  ): Promise<AutocompleteOutcome[]> {
    if (!this.isContinuation(input)) {
      console.log("[SessionManager] Not a continuation. Clearing session");
      this.clearSession();
    }

    this.lastInput = input;

    const rerollCount = this.activeSession.length;
    console.log(
      `[SessionManager] Starting getNextCompletion. Reroll count is: ${rerollCount}`,
    );
    let manualTriggerContext: ManualTriggerContext;

    if (rerollCount > 0) {
      // This is a reroll. Construct the RerollTrigger object.
      const rejectedCompletion = this.activeSession[rerollCount - 1];
      manualTriggerContext = {
        type: "reroll",
        count: rerollCount,
        rejectedCompletionText: rejectedCompletion.completion,
      };
    } else {
      // This is the first forced completion. Construct the ForceTrigger object.
      manualTriggerContext = {
        type: "force",
      };
    }

    console.log(
      "[SessionManager] Manual trigger context:",
      manualTriggerContext,
    );

    // Call the core provider, passing the correctly shaped ManualTriggerContext object.
    const newOutcome =
      await this.completionProvider.provideInlineCompletionItems(
        input,
        token,
        manualTriggerContext,
      );

    console.log(
      "[SessionManager] Received new outcome from core provider:",
      newOutcome?.completion.slice(0, 50) + "...",
    );

    if (newOutcome) {
      // Add the new suggestion to our session's history.
      this.activeSession.push(newOutcome);
      this.lastInput = input;
    } else if (this.activeSession.length > 0) {
      // If we fail to get a new suggestion but had a session,
      // it's better to clear it than to return a stale list.
      this.clearSession();
    }

    console.log(
      `[SessionManager] Returning session with ${this.activeSession.length} total outcomes.`,
    );

    // Return a copy of the full session history for the IDE to display.
    return [...this.activeSession];
  }

  /**
   * A simple getter for the active session, primarily for debugging or
   * logging purposes.
   * @returns A copy of the current session's suggestions.
   */
  public getActiveSession(): AutocompleteOutcome[] {
    return [...this.activeSession];
  }
}
