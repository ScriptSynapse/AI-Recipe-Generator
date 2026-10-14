/**
 * scripts/build-cpp.js
 * ---------------------------------------------------------------------
 * Cross-platform wrapper around the g++ compile command for the C++
 * OOP core. Using a small Node script (instead of a raw shell command
 * in package.json) means the output filename is chosen correctly for
 * the current OS without needing separate "build:cpp" / "build:cpp:win"
 * npm scripts: recipe_engine on Linux/macOS, recipe_engine.exe on
 * Windows. backend/services/cppBridge.js looks for the same
 * platform-correct name at runtime.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const cppCoreDir = path.join(__dirname, '..', 'cpp-core');
const outputName = process.platform === 'win32' ? 'recipe_engine.exe' : 'recipe_engine';
const outputPath = path.join(cppCoreDir, outputName);

// Every translation unit under cpp-core/ (tests/node/buildSources.test.js fails if one is
// forgotten here -- a missing file is a LINK error that only shows up on a fresh build).
const sourceFiles = [
  'main.cpp',
  'models/Recipe.cpp',
  'models/TraditionalRecipe.cpp',
  'models/AIRecipe.cpp',
  'models/User.cpp',
  'models/RecipePreferences.cpp',
  'models/RecipeBuilder.cpp',
  'validation/Validator.cpp',
  'engine/RecipeMatcher.cpp',
  'engine/RecipeCustomizer.cpp',
  'generators/DatabaseGenerator.cpp',
  'generators/AIGenerator.cpp',
  'generators/RecipeTemplateEngine.cpp',
  'storage/RecipeStorage.cpp',
  'ai/http/CurlHttpClient.cpp',
  'ai/HttpLLMProvider.cpp',
  'ai/LLMProviderFactory.cpp',
  'ai/providers/ClaudeProvider.cpp',
  'ai/providers/GeminiProvider.cpp',
  'ai/providers/OpenAIProvider.cpp',
  'ai/providers/GroqProvider.cpp',
  'ai/providers/LocalProvider.cpp',
  'ai/ModelRouter.cpp',
  'ai/AIOrchestrator.cpp',
  'ai/ModelComparator.cpp',
  'evaluation/RecipeEvaluator.cpp',
  'evaluation/IngredientConsistencyChecker.cpp',
  'validation/AIOutputValidator.cpp',
  'security/SecurityPipeline.cpp',
  'security/checks/InputValidatorCheck.cpp',
  'security/checks/AIOutputValidatorCheck.cpp',
  'security/PromptSecurityScanner.cpp',
  'security/checks/PromptInjectionDetectorCheck.cpp',
  'security/XSSDetector.cpp',
  'security/checks/XSSDetectorCheck.cpp',
  'security/events/SecurityEventFactory.cpp',
];
const sources = sourceFiles.map((relativePath) => path.join(cppCoreDir, relativePath));

const args = ['-std=c++17', '-O2', '-Wall', '-pthread', ...sources, '-lcurl', '-o', outputPath];

function main() {
  console.log(`Compiling C++ recipe engine -> ${outputPath}`);
  console.log(`g++ ${args.join(' ')}`);

  const result = spawnSync('g++', args, { stdio: 'inherit' });

  if (result.error) {
    console.error('\nFailed to invoke g++. Is a C++17 compiler installed and on your PATH?');
    console.error('- Linux (Debian/Ubuntu): sudo apt-get install -y g++ libcurl4-openssl-dev');
    console.error('- macOS: xcode-select --install   (and brew install curl if needed)');
    console.error('- Windows: install MSYS2 (https://www.msys2.org), then from the');
    console.error('  "MSYS2 MinGW64" terminal: pacman -S mingw-w64-x86_64-gcc mingw-w64-x86_64-curl');
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\ng++ exited with status ${result.status}. See the compiler output above for details.`);
    process.exit(result.status || 1);
  }

  console.log(`\nBuild succeeded: ${outputPath}`);
}

if (require.main === module) main();

module.exports = { sourceFiles };
