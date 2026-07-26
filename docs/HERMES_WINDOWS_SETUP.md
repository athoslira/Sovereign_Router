# Guia de configuração: Hermes Desktop + Sovereign Router no Windows

Este guia configura o Hermes como runtime externo do Sovereign Router. Ele foi validado em Windows 10, PowerShell 5.1, Obsidian 1.12.7 e Hermes 0.19.0.

O fluxo é local:

```text
Obsidian + Sovereign Router
        │ HTTP local autenticado
        ▼
Hermes Gateway (127.0.0.1:8642)
        │
        ▼
OpenRouter, terminal, cron, ferramentas e MCPs do Hermes
```

Não exponha a porta `8642` à internet. A configuração abaixo mantém o gateway restrito a `127.0.0.1`.

## Antes de começar

- Instale e abra o Hermes Desktop pelo menos uma vez.
- Configure um modelo e a chave OpenRouter no Hermes Desktop.
- Instale/atualize o Sovereign Router e habilite o plugin no Obsidian.
- Feche atualizações pendentes do Hermes antes de editar sua configuração. Enquanto o aplicativo estiver em **Connecting**, aguarde a atualização terminar.

## 1. Localize o Hermes

No Hermes Desktop para Windows, o comando `hermes` pode não estar no `PATH`. Use o executável instalado diretamente:

```powershell
$HermesHome = "$env:LOCALAPPDATA\hermes"
$Hermes = "$HermesHome\hermes-agent\venv\Scripts\hermes.exe"
$env:HERMES_HOME = $HermesHome

& $Hermes dump
```

O resultado deve mostrar o `hermes_home`, um provider/modelo configurado e o gateway parado. Se o caminho for diferente, use o valor mostrado pelo próprio `dump`.

## 2. Gere a chave local da API

No PowerShell 5.1, use este bloco. Ele gera 32 bytes criptograficamente aleatórios, copia a chave para a área de transferência e não a imprime:

```powershell
$bytes = New-Object byte[] 32
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$rng.GetBytes($bytes)
$rng.Dispose()

$ApiKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
Set-Clipboard $ApiKey
Write-Host 'Chave segura criada e copiada para a área de transferência.'
```

Não use `RandomNumberGenerator::Fill` ou `Convert::ToHexString` no PowerShell 5.1: esses métodos exigem versões mais novas do .NET.

## 3. Habilite o gateway e o CORS do Obsidian

Abra o arquivo de ambiente do Hermes:

```powershell
notepad "$HermesHome\.env"
```

No final, adicione estas linhas. Cole a chave com `Ctrl+V` no valor de `API_SERVER_KEY`.

```text
API_SERVER_ENABLED=true
API_SERVER_KEY=COLE_A_CHAVE_GERADA_AQUI
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_CORS_ORIGINS=app://obsidian.md
```

`API_SERVER_CORS_ORIGINS` é necessário porque o Sovereign Router usa requisições autenticadas e streaming dentro do Electron/Obsidian. Liberar somente `app://obsidian.md` permite o aplicativo local sem abrir a API para outros sites.

Não coloque essa chave no vault, em notas Markdown, no `data.json` do plugin ou em conversas.

## 4. Inicie e valide o gateway

No PowerShell, inicie o gateway em primeiro plano:

```powershell
$env:HERMES_HOME = "$env:LOCALAPPDATA\hermes"
& "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\hermes.exe" gateway run
```

Mantenha essa janela aberta. Em outro PowerShell, teste a saúde do serviço:

```powershell
Invoke-RestMethod http://127.0.0.1:8642/health
```

O resultado esperado inclui:

```text
status   : ok
platform : hermes-agent
```

Para validar também a chave, sem imprimi-la:

```powershell
$HermesHome = "$env:LOCALAPPDATA\hermes"
$keyLine = Get-Content "$HermesHome\.env" | Where-Object { $_ -match '^API_SERVER_KEY=' } | Select-Object -Last 1
$ApiKey = $keyLine.Substring('API_SERVER_KEY='.Length)

Invoke-RestMethod http://127.0.0.1:8642/v1/models -Headers @{ Authorization = "Bearer $ApiKey" }
```

O retorno deve listar o modelo `hermes-agent`.

## 5. Configure o Sovereign Router

No Obsidian, abra **Settings → Community plugins → Sovereign Router**. Em **Hermes Agent runtime**:

| Campo | Valor |
|---|---|
| Hermes API URL | `http://127.0.0.1:8642` |
| Hermes API key | Crie/selecione um segredo no SecretStorage do Obsidian e cole a mesma chave de `API_SERVER_KEY` |
| Allow automatic Hermes routing | Desligado inicialmente |

Use somente a URL base: não acrescente `/v1`, `/health` ou `/runs`.

No painel do Sovereign Router, crie uma sessão, selecione **Hermes Agent** e envie:

```text
Responda somente: Hermes conectado com sucesso.
```

Quando a resposta chegar, a integração está pronta. Só então avalie habilitar o roteamento automático.

## Diagnóstico rápido

| Sintoma | Causa provável | Como resolver |
|---|---|---|
| `hermes` não é reconhecido | CLI fora do `PATH` | Use o caminho completo mostrado na seção 1. |
| Hermes Desktop fica em `Connecting` | Atualização do Desktop em andamento | Aguarde a conclusão; não altere arquivos durante a atualização. |
| `/health` não responde | Gateway desligado ou porta errada | Rode `& $Hermes gateway run` e mantenha o processo ativo. |
| `/v1/models` retorna 401 | Chave no plugin ou no comando é diferente da chave em `.env` | Recrie/seleciona o segredo correto no Obsidian e reinicie o gateway após alterar `.env`. |
| Plugin mostra `Request error` e o console exibe CORS/403 | `API_SERVER_CORS_ORIGINS` ausente ou gateway não reiniciado | Adicione `API_SERVER_CORS_ORIGINS=app://obsidian.md` e reinicie o gateway. |
| O `POST /v1/runs` funciona, mas `/events` dá erro CORS | Bug de streaming SSE na versão Hermes 0.19.0 | Aplique o workaround abaixo ou atualize para uma versão que contenha a correção. |
| O Hermes não consegue responder apesar de o gateway estar saudável | Provider/modelo ou DNS sem acesso | Execute `& $Hermes dump`, confirme OpenRouter/modelo e teste a conectividade com `openrouter.ai`. |

## Workaround para o SSE no Hermes 0.19.0

Na versão 0.19.0, o endpoint `GET /v1/runs/{run_id}/events` pode iniciar o stream antes de o middleware CORS adicionar os cabeçalhos. O console do Obsidian mostra então:

```text
No 'Access-Control-Allow-Origin' header is present on the requested resource
```

Pare o gateway e edite:

```text
%LOCALAPPDATA%\hermes\hermes-agent\gateway\platforms\api_server.py
```

Dentro de `_handle_run_events`, substitua a criação direta de `web.StreamResponse` por este bloco, imediatamente antes de `await response.prepare(request)`:

```python
response_headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
}
origin = request.headers.get("Origin", "")
cors_headers = self._cors_headers_for_origin(origin) if origin else None
if cors_headers:
    response_headers.update(cors_headers)

response = web.StreamResponse(
    status=200,
    headers=response_headers,
)
```

Reinicie o gateway e repita o teste do passo 5. Esse workaround foi validado com o Sovereign Router. Uma atualização do Hermes pode substituir o arquivo; após atualizar, repita o teste antes de reaplicar o patch.

## Operação segura

- Deixe o host em `127.0.0.1`; não use `0.0.0.0` para esse caso.
- Use SecretStorage para a chave no Obsidian; o plugin guarda apenas a referência do segredo.
- Mantenha **Allow automatic Hermes routing** desligado até concluir testes manuais.
- Comece com tarefas sem escrita. Depois, restrinja arquivos de saída a uma pasta explícita do vault, como `09 Data/`.
- Configure cron, MCP local ou ferramentas de terminal somente depois que o chat Hermes manual estiver estável.
- Após qualquer atualização do Hermes, valide novamente `/health`, `/v1/models` e o teste de sessão Hermes.

## Próxima etapa: automações

Depois da conexão estável, configure automações em lotes pequenos. O padrão recomendado é:

```text
Script determinístico seleciona registros pendentes
        ↓
Sem registros: não chama IA
        ↓
Hermes pesquisa e produz JSON estruturado com fonte e confiança
        ↓
Validador atualiza a base de forma atômica
        ↓
Casos de baixa confiança vão para revisão humana
```

Use o modelo operacional do projeto para definir a fronteira de responsabilidades, segurança e custo entre Sovereign Router e Hermes antes de habilitar automações recorrentes.
