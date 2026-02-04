// Direct Claude Code SDK - Use Node.js SDK with permissions bypass
import { query } from '@anthropic-ai/claude-code';

export default class ACPConnection {
  constructor() {
    this.sessionId = null;
    this.onUpdate = null;
  }

  async connect(agentType, cwd) {
    console.log(`[ACP-Direct] Using Claude Code SDK with dangerously-skip-permissions mode`);
  }

  async initialize() {
    return { ready: true };
  }

  async newSession(cwd) {
    this.sessionId = Math.random().toString(36).substring(7);
    return { sessionId: this.sessionId };
  }

  async setSessionMode(modeId) {
    return { modeId };
  }

  async injectSkills() {
    return { skills: [] };
  }

  async injectSystemContext() {
    return { context: '' };
  }

  async sendPrompt(prompt) {
    const promptText = typeof prompt === 'string' ? prompt : prompt.map(p => p.text).join('\n');
    
    console.log(`[ACP-Direct] Sending prompt to Claude Code SDK (${promptText.length} chars)`);

    try {
      // Use the SDK's query method with permissions bypass
      const response = query({
        prompt: promptText,
        options: { 
          permissionMode: 'bypassPermissions'
        }
      });

      // Collect all messages and render with RippleUI components
      const htmlParts = [];
      let hasStarted = false;
      const allText = '';
      const toolCalls = [];
      let totalDuration = 0;

      for await (const message of response) {
        const msgType = message.type;
        
        // Handle assistant messages with content
        if (msgType === 'assistant' && message.message?.content) {
          if (!hasStarted) {
            hasStarted = true;
            // RippleUI Alert component for thinking state - full width
            htmlParts.push(`
<div class="ripple-alert ripple-alert-info" role="alert" style="width: 100%; box-sizing: border-box;">
  <div class="ripple-alert-content">
    <span class="ripple-icon">💭</span>
    <div>
      <h4 class="ripple-alert-title" style="margin-bottom: 0.25rem;">Processing Request</h4>
      <p class="ripple-alert-message" style="margin: 0;">Claude Code is analyzing and executing your request...</p>
    </div>
  </div>
</div>`);
          }

          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                // Emit update for real-time streaming
                if (this.onUpdate) {
                  this.onUpdate({
                    update: {
                      sessionUpdate: 'agent_message_chunk',
                      content: { text: block.text }
                    }
                  });
                }
                
                // RippleUI Card for text response - full width
                htmlParts.push(`
<div class="ripple-card ripple-card-subtle" style="width: 100%; box-sizing: border-box;">
  <div class="ripple-card-body">
    <p class="ripple-text-base ripple-text-secondary" style="white-space: pre-wrap; line-height: 1.6; margin: 0;">${this._escapeHtml(block.text)}</p>
  </div>
</div>`);
              } else if (block.type === 'tool_use') {
                // Track tool call
                toolCalls.push({
                  name: block.name,
                  input: block.input
                });

                // RippleUI Card with Badge for tool execution - full width
                const inputJson = JSON.stringify(block.input, null, 2);
                const toolHtml = `
<div class="ripple-card ripple-card-warning" style="width: 100%; box-sizing: border-box;">
  <div class="ripple-card-header">
    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
      <span class="ripple-badge ripple-badge-warning">🔧 Tool</span>
      <code class="ripple-code-inline ripple-text-lg">${this._escapeHtml(block.name)}</code>
    </div>
  </div>
  <div class="ripple-card-body">
    <h5 class="ripple-text-sm ripple-text-secondary ripple-font-semibold" style="margin-bottom: 0.75rem; margin-top: 0;">Input Parameters</h5>
    <pre class="ripple-code-block ripple-bg-secondary ripple-rounded ripple-p-md" style="overflow-x: auto; width: 100%; box-sizing: border-box; margin: 0;"><code>${this._escapeHtml(inputJson)}</code></pre>
  </div>
</div>`;
                
                htmlParts.push(toolHtml);
                
                // Emit update
                if (this.onUpdate) {
                  this.onUpdate({
                    update: {
                      sessionUpdate: 'agent_message_chunk',
                      content: { text: toolHtml }
                    }
                  });
                }
              }
            }
          }
        }
        
        // Handle result messages (completion)
        if (msgType === 'result') {
          totalDuration = message.duration_ms || 0;
          
          // RippleUI Success Alert with stats - full width
          const statsHtml = `
<div class="ripple-alert ripple-alert-success" role="alert" style="width: 100%; box-sizing: border-box;">
  <div class="ripple-alert-content">
    <span class="ripple-icon">✅</span>
    <div>
      <h4 class="ripple-alert-title" style="margin-bottom: 0.5rem;">Execution Complete</h4>
      <div class="ripple-text-sm ripple-mt-xs" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-top: 0.5rem;">
        <div>
          <span class="ripple-text-secondary">Duration:</span><br/>
          <code class="ripple-code-inline ripple-text-success">${totalDuration}ms</code>
        </div>
        <div>
          <span class="ripple-text-secondary">Tools Executed:</span><br/>
          <code class="ripple-code-inline ripple-text-success">${toolCalls.length}</code>
        </div>
      </div>
    </div>
  </div>
</div>`;
          
          htmlParts.push(statsHtml);
          
          // Emit final update
          if (this.onUpdate) {
            this.onUpdate({
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { text: statsHtml }
              }
            });
          }
        }
      }

      // Combine all HTML parts with RippleUI container - full width styling
      const fullHtml = `
<div style="display: flex; flex-direction: column; gap: 1rem; width: 100%;">
  ${htmlParts.join('\n  ')}
</div>`;
      
      // Also wrap to ensure cards fill width
      const styledHtml = `<style>
.ripple-card, .ripple-alert {
  width: 100% !important;
  max-width: none !important;
}
.ripple-code-block {
  width: 100% !important;
}
</style>
${fullHtml}`;
      
      console.log(`[ACP-Direct] ✓ Response rendered with RippleUI (${styledHtml.length} chars, ${toolCalls.length} tools)`);
      return { content: styledHtml || 'No response from agent' };
    } catch (err) {
      console.error(`[ACP-Direct] Query error: ${err.message}`);
      throw err;
    }
  }

  _escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  isRunning() {
    return true;
  }

  async terminate() {
    return;
  }
}
