# Protecting the `main` branch

`main` is the code that gets deployed. Protecting it means nobody (including you) can put
a change on `main` unless it went through a pull request and every automatic check passed
(SPEC §17). This takes about ten minutes and is done once, on github.com.

## Before you start

- **You need admin access** to the repository. If you don't see a **Settings** tab at the
  top of the repository page, ask the repository owner to do this or to make you an admin.
- **Private repositories need a paid plan.** On GitHub Free, protection rules only work on
  public repositories. A private repository needs GitHub Pro (personal account) or GitHub
  Team (organization). GitHub shows a banner on the settings pages below if this applies.
- **Let the checks run once.** GitHub only offers check names it has seen in the last
  7 days. Make sure `.github/workflows/ci.yml` is on `main`, then open the **Actions** tab
  and confirm a run named **CI** has finished (green or red does not matter yet).

## The three checks

The workflow runs three jobs. You will select these exact names in step 7.

| Check name | What it proves |
|---|---|
| `checks` | Code style (lint), type checks, all automated tests against a real database, and that the website builds. |
| `mobile-bundle` | The iOS and Android apps still bundle. |
| `e2e` | Browser tests: sign-up (including the Nova Scotia rule), sign-in, onboarding, the verification gate and community pages, on desktop and phone sizes, with accessibility checks. |

## Set up the rule (recommended: ruleset)

1. Go to the repository on **github.com** and click **Settings** (the gear tab at the
   top, after Insights).
2. In the left sidebar, under **Code and automation**, click **Rules**, then
   **Rulesets**.
3. Click **New ruleset**, then **New branch ruleset**.
4. Fill in the top of the form:
   - **Ruleset Name:** `Protect main`
   - **Enforcement status:** choose **Active**.
   - **Bypass list:** leave it empty, so the rules apply to everyone, admins included.
     (If you want an emergency override for yourself, click **Add bypass**, choose
     **Repository admin**, and set it to **For pull requests only**. Only use it in a
     real emergency.)
5. Under **Target branches**, click **Add target**, then **Include default branch**.
   The default branch now appears in the target list. (Check that `main` is your default
   branch: it is shown under **Settings → General → Default branch**.)
6. Under **Branch rules**, tick or check these boxes:
   - **Restrict deletions** (already ticked): nobody can delete `main`.
   - **Require a pull request before merging.** In the options that appear:
     - **Required approvals:** set `0` if you are the only person who merges changes
       (GitHub never lets you approve your own pull request, so `1` would block you).
       Set `1` once a second person reviews code.
     - Tick **Require conversation resolution before merging** so open review comments
       must be resolved first.
   - **Block force pushes** (already ticked): history on `main` can't be rewritten.
7. Tick **Require status checks to pass**, then:
   - Tick **Require branches to be up to date before merging** (each pull request is
     re-tested against the latest `main`; use the **Update branch** button on the pull
     request when GitHub asks).
   - Click **Add checks**, type `checks`, and click the `checks` entry (if a source is
     shown, pick **GitHub Actions**). Do the same for `mobile-bundle` and `e2e`.
   - The list under the button should now show exactly `checks`, `mobile-bundle` and
     `e2e`.
8. Scroll to the bottom and click **Create**.

## Alternative: classic branch protection rule

Use this only if your plan or organization does not offer rulesets.

1. **Settings** → left sidebar **Branches** → **Add classic branch protection rule**
   (older pages call it **Add rule**).
2. **Branch name pattern:** `main`
3. Tick **Require a pull request before merging** and set **Require approvals** as in
   step 6 above.
4. Tick **Require status checks to pass before merging**, then tick **Require branches to
   be up to date before merging**, and in the search box add `checks`, `mobile-bundle`
   and `e2e`.
5. Tick **Require conversation resolution before merging**.
6. Tick **Do not allow bypassing the above settings** (this applies the rule to admins).
7. Leave **Allow force pushes** and **Allow deletions** unticked.
8. Click **Create**.

## Check that it works

1. Open any pull request (Dependabot's weekly update pull requests are a good test).
2. Near the bottom of the pull request you should see the three checks listed as
   **Required**, and the **Merge pull request** button stays grey until all three pass.
3. Try **Settings → Rules → Rulesets** again: `Protect main` should show as **Active**.

## Related settings worth turning on

- **Settings → Actions → General → Workflow permissions:** choose **Read repository
  contents and packages permissions**, and leave **Allow GitHub Actions to create and
  approve pull requests** unticked. The CI workflow only needs read access.
- **Settings → Advanced Security** (called **Code security** on some plans): turn on
  **Dependabot alerts** and **Dependabot security updates**. Weekly version updates come
  from `.github/dependabot.yml` automatically once it is on `main`.

## Troubleshooting

| Problem | Fix |
|---|---|
| A check name doesn't appear when you search | The workflow hasn't run in the last 7 days. Push a commit or open a pull request, wait for the **CI** run to finish, then search again. |
| A pull request says "Expected — Waiting for status to be reported" forever | A required check name no longer matches the workflow (a job was renamed). Edit the ruleset and replace the old name with the new one. |
| You can't merge your own pull request | **Required approvals** is above `0` and nobody else can review. Set it to `0` (step 6) or add a reviewer. |
| A check failed | Open the pull request's **Checks** tab, click the red job and read the first error. For `e2e`, download the **playwright-report** file from the run's **Summary** page and open `index.html` to see screenshots of what went wrong. |
