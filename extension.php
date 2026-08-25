<?php
declare(strict_types=1);

/**
 * FreshRSS AI Translator
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
final class AITranslatorExtension extends Minz_Extension {
    private const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
    private const DEFAULT_TITLE_MODEL = 'gpt-4o-mini';
    private const DEFAULT_CONTENT_MODEL = 'gpt-4o-mini';
    private const DEFAULT_SUMMARY_MODEL = 'gpt-4o-mini';

    private const DEFAULT_TITLE_PROMPT = <<<'PROMPT'
You are a Chinese information-feed title translator.
Translate each supplied title into concise, natural Simplified Chinese.

Rules:
1. Preserve product, model, library, framework, API, and technical names such as Blender, Geometry Nodes, Python, PyTorch, CUDA, OpenAI.
2. For Japanese anime, manga, visual novels, and games, prefer the established/common Simplified Chinese title when confidently known. Romanized Japanese titles should be recognized as titles rather than translated word-for-word.
3. Do not invent facts not present in the title.
4. If a title is already mainly Simplified Chinese, return it unchanged.
5. Output must be strict JSON only and must preserve every input id exactly.
PROMPT;

    private const DEFAULT_CONTENT_PROMPT = <<<'PROMPT'
You are a professional Chinese technical translator.
Translate each supplied text block into natural, accurate Simplified Chinese.

Rules:
1. Preserve technical terms when that is clearer. On first mention, a form such as "Subdivision Surface（细分曲面）" is acceptable.
2. Do not translate code, commands, file paths, URLs, model identifiers, or API names.
3. For anime, manga, visual novels, and games, prefer established/common Simplified Chinese titles when confidently known.
4. Preserve meaning and tone. Do not add facts or commentary.
5. Output must be strict JSON only and must preserve every input id exactly.
PROMPT;

    private const DEFAULT_SUMMARY_PROMPT = <<<'PROMPT'
Summarize the article in Simplified Chinese.
Start with 2-3 sentences explaining what the article is about, then give 3-6 key points.
For technical tutorials, mention the tools/methods and the practical goal.
For Blender tutorials, mention what problem is solved, the main workflow, and the suitable skill level when inferable from the article.
For AI news, explain what changed and why it matters.
For anime/game news, prefer established/common Simplified Chinese titles when confidently known.
Do not invent information that is not present in the article.
PROMPT;

    public function init(): void {
        $this->registerController('AITranslator');
        $this->registerHook('js_vars', [$this, 'injectJsVars']);
        Minz_View::appendScript($this->getFileUrl('ai-translator.js'));
        Minz_View::appendStyle($this->getFileUrl('ai-translator.css'));
    }

    public function handleConfigureAction(): void {
        if (!Minz_Request::isPost()) {
            return;
        }

        $baseUrl = rtrim(trim(Minz_Request::paramString('api_base_url', true)), '/');
        $postedKey = trim(Minz_Request::paramString('api_key', true));
        $currentKey = $this->getConfigValue('api_key');

        $displayMode = Minz_Request::paramString('display_mode', true);
        if (!in_array($displayMode, ['bilingual', 'zh', 'original'], true)) {
            $displayMode = 'bilingual';
        }

        $batchSize = (int)Minz_Request::paramString('title_batch_size', true);
        $batchSize = max(1, min(30, $batchSize ?: 12));

        $config = [
            'api_base_url' => $baseUrl !== '' ? $baseUrl : self::DEFAULT_BASE_URL,
            'api_key' => $postedKey !== '' ? $postedKey : $currentKey,
            'title_model' => trim(Minz_Request::paramString('title_model', true)) ?: self::DEFAULT_TITLE_MODEL,
            'content_model' => trim(Minz_Request::paramString('content_model', true)) ?: self::DEFAULT_CONTENT_MODEL,
            'summary_model' => trim(Minz_Request::paramString('summary_model', true)) ?: self::DEFAULT_SUMMARY_MODEL,
            'auto_translate_titles' => Minz_Request::paramString('auto_translate_titles', true) === '1' ? '1' : '0',
            'auto_translate_content' => Minz_Request::paramString('auto_translate_content', true) === '1' ? '1' : '0',
            'display_mode' => $displayMode,
            'title_batch_size' => (string)$batchSize,
            'title_prompt' => trim(Minz_Request::paramString('title_prompt', true)) ?: self::DEFAULT_TITLE_PROMPT,
            'content_prompt' => trim(Minz_Request::paramString('content_prompt', true)) ?: self::DEFAULT_CONTENT_PROMPT,
            'summary_prompt' => trim(Minz_Request::paramString('summary_prompt', true)) ?: self::DEFAULT_SUMMARY_PROMPT,
        ];

        $this->setConfigValues($config);
        Minz_Request::good('AI Translator settings saved.', [
            'c' => 'extension',
            'a' => 'configure',
            'params' => ['e' => $this->getName()],
        ]);
    }

    /** @param array<string,mixed> $vars */
    public function injectJsVars(array $vars): array {
        $vars['aiTranslator'] = [
            'titleEndpoint' => '?c=AITranslator&a=translateTitles',
            'blocksEndpoint' => '?c=AITranslator&a=translateBlocks',
            'summaryEndpoint' => '?c=AITranslator&a=summary',
            'csrf' => FreshRSS_Auth::csrfToken(),
            'autoTranslateTitles' => $this->getConfigValue('auto_translate_titles', '1') === '1',
            'autoTranslateContent' => $this->getConfigValue('auto_translate_content', '1') === '1',
            'displayMode' => $this->getConfigValue('display_mode', 'bilingual'),
            'titleBatchSize' => (int)$this->getConfigValue('title_batch_size', '12'),
        ];
        return $vars;
    }

    public function getConfigValue(string $key, string $default = ''): string {
        $value = $this->getUserConfigurationValue($key, $default);
        if (is_string($value) || is_int($value) || is_bool($value)) {
            $s = (string)$value;
            return $s !== '' ? $s : $default;
        }
        return $default;
    }

    /** @param array<string,mixed> $values */
    public function setConfigValues(array $values): void {
        $current = $this->getUserConfiguration();
        foreach ($values as $key => $value) {
            if (is_string($value) || is_int($value) || is_bool($value)) {
                $current[$key] = (string)$value;
            }
        }
        $this->setUserConfiguration($current);
    }

    public function getApiBaseUrl(): string { return $this->getConfigValue('api_base_url', self::DEFAULT_BASE_URL); }
    public function getApiKey(): string { return $this->getConfigValue('api_key'); }
    public function getTitleModel(): string { return $this->getConfigValue('title_model', self::DEFAULT_TITLE_MODEL); }
    public function getContentModel(): string { return $this->getConfigValue('content_model', self::DEFAULT_CONTENT_MODEL); }
    public function getSummaryModel(): string { return $this->getConfigValue('summary_model', self::DEFAULT_SUMMARY_MODEL); }
    public function getTitlePrompt(): string { return $this->getConfigValue('title_prompt', self::DEFAULT_TITLE_PROMPT); }
    public function getContentPrompt(): string { return $this->getConfigValue('content_prompt', self::DEFAULT_CONTENT_PROMPT); }
    public function getSummaryPrompt(): string { return $this->getConfigValue('summary_prompt', self::DEFAULT_SUMMARY_PROMPT); }

    private function cachePath(): string {
        $user = Minz_User::name() ?? 'default';
        return USERS_PATH . '/' . $user . '/ai-translator-cache.json';
    }

    /** @return array{titles:array<string,array<string,mixed>>,blocks:array<string,array<string,mixed>>} */
    public function readCache(): array {
        $path = $this->cachePath();
        if (!is_file($path)) return ['titles' => [], 'blocks' => []];
        $raw = @file_get_contents($path);
        if (!is_string($raw)) return ['titles' => [], 'blocks' => []];
        $data = json_decode($raw, true);
        if (!is_array($data)) return ['titles' => [], 'blocks' => []];
        return [
            'titles' => is_array($data['titles'] ?? null) ? $data['titles'] : [],
            'blocks' => is_array($data['blocks'] ?? null) ? $data['blocks'] : [],
        ];
    }

    /** @param array{titles:array<string,array<string,mixed>>,blocks:array<string,array<string,mixed>>} $cache */
    public function writeCache(array $cache): void {
        $path = $this->cachePath();
        $dir = dirname($path);
        if (!is_dir($dir)) @mkdir($dir, 0750, true);

        foreach (['titles' => 2500, 'blocks' => 5000] as $bucket => $limit) {
            if (count($cache[$bucket]) > $limit) {
                uasort($cache[$bucket], static function ($a, $b): int {
                    return ((int)($a['ts'] ?? 0)) <=> ((int)($b['ts'] ?? 0));
                });
                $cache[$bucket] = array_slice($cache[$bucket], -$limit, null, true);
            }
        }

        $json = json_encode($cache, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) return;
        $tmp = $path . '.tmp';
        if (@file_put_contents($tmp, $json, LOCK_EX) !== false) {
            @chmod($tmp, 0640);
            @rename($tmp, $path);
        }
    }

    public function titleCacheKey(string $title): string {
        return hash('sha256', $this->getTitleModel() . "\0" . $this->getTitlePrompt() . "\0" . $title);
    }

    public function blockCacheKey(string $text): string {
        return hash('sha256', $this->getContentModel() . "\0" . $this->getContentPrompt() . "\0" . $text);
    }
}
