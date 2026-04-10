  semantic-release setup complete:                                                                                                                                                                                        
                                                                                                                                                                                                                          
  ┌────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────┐                                                                                                     
  │              File              │                                     Change                                     │                                                                                                     
  ├────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤                                                                                                     
  │ .releaserc.json                │ Conventional commits → CHANGELOG → npm publish → GitHub release → git commit   │                                                                                                     
  ├────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤                                                                                                     
  │ .github/workflows/release.yml  │ Triggers on main push; builds then runs npx semantic-release                   │                                                                                                     
  ├────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤                                                                                                     
  │ CHANGELOG.md                   │ Stub file; semantic-release overwrites it on first release                     │                                                                                                     
  ├────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤                                                                                                     
  │ packages/cli/tsup.config.ts    │ noExternal bundles @dev-session/{core,security,adapters} into CLI dist (914KB) │                                                                                                     
  ├────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤                                                                                                     
  │ packages/cli/package.json      │ private removed; @dev-session/* moved from dependencies → devDependencies      │                                                                                                     
  ├────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┤                                                                                                     
  │ packages/adapters/package.json │ Fixed duplicate "license" key (was UNLICENSED due to JS last-wins)             │                                                                                                     
  └────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────┘                                                                                                     
                                                                                                                                                                                                                          
  Before the release workflow can run, add NPM_TOKEN as a GitHub Actions secret (Settings → Secrets → Actions).                                                                                                           
                                                                                                                                                                                                                          
  Commit message convention (triggers releases):                                                                                                                                                                          
  - fix: → patch                                                                                                                                                                                                          
  - feat: → minor                                                                                                                                                                                                         
  - BREAKING CHANGE: in footer → major                                                                                                                                                                                    
                                                                                                                                                                                                                          
  769 tests, typecheck, lint, build all clean. 


  