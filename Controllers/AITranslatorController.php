<?php
declare(strict_types=1);

/** SPDX-License-Identifier: AGPL-3.0-or-later */
final class FreshExtension_AITranslator_Controller extends FreshRSS_ActionController {
    public function translateTitlesAction(): void {
        if (!$this->guardPost()) return;
        $ext = $this->extension();
        if ($ext === null) { $this->json(['ok'=>false,'error'=>'Extension unavailable.'],500); return; }
        $items = $this->readItems('items_json',30);
        if ($items === []) { $this->json(['ok'=>false,'error'=>'No titles supplied.'],400); return; }
        $cache = $ext->readCache(); $results=[]; $misses=[];
        foreach ($items as $item) {
            $id=$item['id']; $title=trim($item['text']); if ($title==='') continue;
            $key=$ext->titleCacheKey($title); $cached=$cache['titles'][$key]['translation'] ?? null;
            if (is_string($cached) && $cached!=='') $results[$id]=$cached;
            else $misses[]=['id'=>$id,'text'=>$title,'cache_key'=>$key];
        }
        if ($misses!==[]) {
            $translated=$this->translateBatch($ext,array_map(static fn(array $x):array=>['id'=>$x['id'],'text'=>$x['text']],$misses),$ext->getTitleModel(),$ext->getTitlePrompt());
            if (!$translated['ok']) { $this->json($translated,502); return; }
            foreach ($misses as $miss) {
                $value=$translated['items'][$miss['id']] ?? null;
                if (!is_string($value) || trim($value)==='') continue;
                $value=trim($value); $results[$miss['id']]=$value;
                $cache['titles'][$miss['cache_key']]=['translation'=>$value,'original'=>$miss['text'],'ts'=>time()];
            }
            $ext->writeCache($cache);
        }
        $this->json(['ok'=>true,'items'=>$results]);
    }

    public function translateBlocksAction(): void {
        if (!$this->guardPost()) return;
        $ext=$this->extension();
        if ($ext===null) { $this->json(['ok'=>false,'error'=>'Extension unavailable.'],500); return; }
        $items=$this->readItems('items_json',20);
        if ($items===[]) { $this->json(['ok'=>false,'error'=>'No text blocks supplied.'],400); return; }
        $cache=$ext->readCache(); $results=[]; $misses=[];
        foreach ($items as $item) {
            $id=$item['id']; $text=trim($item['text']); if ($text==='') continue;
            $key=$ext->blockCacheKey($text); $cached=$cache['blocks'][$key]['translation'] ?? null;
            if (is_string($cached) && $cached!=='') $results[$id]=$cached;
            else $misses[]=['id'=>$id,'text'=>$text,'cache_key'=>$key];
        }
        if ($misses!==[]) {
            $translated=$this->translateBatch($ext,array_map(static fn(array $x):array=>['id'=>$x['id'],'text'=>$x['text']],$misses),$ext->getContentModel(),$ext->getContentPrompt());
            if (!$translated['ok']) { $this->json($translated,502); return; }
            foreach ($misses as $miss) {
                $value=$translated['items'][$miss['id']] ?? null;
                if (!is_string($value) || trim($value)==='') continue;
                $value=trim($value); $results[$miss['id']]=$value;
                $cache['blocks'][$miss['cache_key']]=['translation'=>$value,'original'=>$miss['text'],'ts'=>time()];
            }
            $ext->writeCache($cache);
        }
        $this->json(['ok'=>true,'items'=>$results]);
    }

    public function summaryAction(): void {
        if (!$this->guardPost()) return;
        $ext=$this->extension();
        if ($ext===null) { $this->json(['ok'=>false,'error'=>'Extension unavailable.'],500); return; }
        $text=trim(Minz_Request::paramString('text',true));
        if ($text==='') { $this->json(['ok'=>false,'error'=>'Article text is empty.'],400); return; }
        if (mb_strlen($text,'UTF-8')>60000) $text=mb_substr($text,0,60000,'UTF-8');
        $reply=$this->requestCompletion($ext->getApiBaseUrl(),$ext->getApiKey(),$ext->getSummaryModel(),$ext->getSummaryPrompt(),$text);
        if (!$reply['ok']) { $this->json($reply,502); return; }
        $this->json(['ok'=>true,'summary'=>trim($reply['content'])]);
    }

    private function guardPost(): bool {
        if (!FreshRSS_Auth::hasAccess()) { $this->json(['ok'=>false,'error'=>'Authentication required.'],401); return false; }
        if (!Minz_Request::isPost()) { $this->json(['ok'=>false,'error'=>'POST required.'],405); return false; }
        if (!FreshRSS_Auth::isCsrfOk()) { $this->json(['ok'=>false,'error'=>'Invalid CSRF token.'],403); return false; }
        return true;
    }

    private function extension(): ?AITranslatorExtension {
        foreach (Minz_ExtensionManager::listExtensions(true) as $extension) if ($extension instanceof AITranslatorExtension) return $extension;
        return null;
    }

    /** @return list<array{id:string,text:string}> */
    private function readItems(string $param,int $maxItems): array {
        $decoded=json_decode(Minz_Request::paramString($param,true),true); if (!is_array($decoded)) return [];
        $items=[];
        foreach (array_slice($decoded,0,$maxItems) as $item) {
            if (!is_array($item)) continue; $id=$item['id'] ?? ''; $text=$item['text'] ?? '';
            if ((!is_string($id) && !is_int($id)) || !is_string($text)) continue;
            $id=mb_substr((string)$id,0,100,'UTF-8'); $text=mb_substr($text,0,12000,'UTF-8');
            if ($id!=='' && trim($text)!=='') $items[]=['id'=>$id,'text'=>$text];
        }
        return $items;
    }

    /** @return array{ok:true,items:array<string,string>}|array{ok:false,error:string} */
    private function translateBatch(AITranslatorExtension $ext,array $items,string $model,string $prompt): array {
        $payload=json_encode($items,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
        if (!is_string($payload)) return ['ok'=>false,'error'=>'Failed to encode translation batch.'];
        $userPrompt="Translate the following JSON array. Return strict JSON only in this shape: [{\"id\":\"same-id\",\"translation\":\"...\"}].\n\nINPUT:\n".$payload;
        $reply=$this->requestCompletion($ext->getApiBaseUrl(),$ext->getApiKey(),$model,$prompt,$userPrompt);
        if (!$reply['ok']) return $reply;
        $text=trim($reply['content']);
        if (str_starts_with($text,'```')) { $text=preg_replace('/^```(?:json)?\s*/i','',$text) ?? $text; $text=preg_replace('/\s*```$/','',$text) ?? $text; }
        $decoded=json_decode(trim($text),true); if (!is_array($decoded)) return ['ok'=>false,'error'=>'The model did not return valid JSON.'];
        $results=[];
        foreach ($decoded as $row) {
            if (!is_array($row)) continue; $id=$row['id'] ?? ''; $translation=$row['translation'] ?? '';
            if ((is_string($id)||is_int($id)) && is_string($translation) && trim($translation)!=='') $results[(string)$id]=trim($translation);
        }
        return ['ok'=>true,'items'=>$results];
    }

    /** @return array{ok:true,content:string}|array{ok:false,error:string} */
    private function requestCompletion(string $baseUrl,string $apiKey,string $model,string $systemPrompt,string $userContent): array {
        if ($apiKey==='') return ['ok'=>false,'error'=>'API key is not configured.'];
        $parts=parse_url($baseUrl);
        if (!is_array($parts) || strtolower((string)($parts['scheme'] ?? ''))!=='https' || empty($parts['host'])) return ['ok'=>false,'error'=>'API base URL must be a valid HTTPS URL.'];
        if (isset($parts['user']) || isset($parts['pass'])) return ['ok'=>false,'error'=>'Credentials in the API base URL are not allowed.'];
        $endpoint=rtrim($baseUrl,'/').'/chat/completions';
        $body=json_encode(['model'=>$model,'temperature'=>0.2,'messages'=>[['role'=>'system','content'=>$systemPrompt],['role'=>'user','content'=>$userContent]]],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
        if (!is_string($body)) return ['ok'=>false,'error'=>'Failed to build API request.'];
        $ch=curl_init($endpoint); if ($ch===false) return ['ok'=>false,'error'=>'Could not initialize API request.'];
        curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.$apiKey],CURLOPT_POSTFIELDS=>$body,CURLOPT_TIMEOUT=>180,CURLOPT_CONNECTTIMEOUT=>30,CURLOPT_FOLLOWLOCATION=>false]);
        $response=curl_exec($ch); $curlError=curl_error($ch); $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
        if ($response===false) return ['ok'=>false,'error'=>$curlError!==''?$curlError:'API request failed.'];
        $decoded=json_decode((string)$response,true); if (!is_array($decoded)) return ['ok'=>false,'error'=>'API returned an invalid response.'];
        if (isset($decoded['error']) && is_array($decoded['error'])) { $message=$decoded['error']['message'] ?? 'API returned an error.'; return ['ok'=>false,'error'=>is_string($message)?$message:'API returned an error.']; }
        if ($status<200 || $status>=300) return ['ok'=>false,'error'=>'API request failed with HTTP '.$status.'.'];
        $content=$decoded['choices'][0]['message']['content'] ?? null; if (!is_string($content) || trim($content)==='') return ['ok'=>false,'error'=>'API returned empty content.'];
        return ['ok'=>true,'content'=>$content];
    }

    /** @param array<string,mixed> $payload */
    private function json(array $payload,int $status=200): void {
        if (ob_get_level()>0) ob_clean(); $this->view->_layout(null); http_response_code($status); header('Content-Type: application/json; charset=UTF-8');
        $json=json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); echo is_string($json)?$json:'{"ok":false,"error":"JSON encoding failed."}'; exit;
    }
}
