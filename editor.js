/* global document, window */

class PosterEditor {
  constructor (container, options = {}) {
    this.container = container
    this.onChange = options.onChange || (() => {})
    this.onImageRequest = options.onImageRequest || (() => {})
    this._savedRange = null
    this._imgToolbar = null
    this._imgToolbarHandler = null
    this._activeImg = null
    this._build()
  }

  _build () {
    // toolbar
    this.toolbar = document.createElement('div')
    this.toolbar.className = 'editor-toolbar'
    this.toolbar.setAttribute('role', 'toolbar')

    // HTML toggle button (added first so it's always visible on the right)
    const htmlBtn = document.createElement('button')
    htmlBtn.type = 'button'
    htmlBtn.textContent = 'HTML'
    htmlBtn.title = 'Toggle HTML source view'
    htmlBtn.className = 'editor-btn btn-mono'
    htmlBtn.dataset.cmd = 'toggleHtml'
    htmlBtn.addEventListener('mousedown', e => {
      e.preventDefault()
      this._toggleHtmlView(htmlBtn)
    })
    this._htmlToggleBtn = htmlBtn

    const buttons = [
      { cmd: 'bold',        label: 'B',      cls: 'btn-bold',      title: 'Bold (Ctrl+B)' },
      { cmd: 'italic',      label: 'I',      cls: 'btn-italic',    title: 'Italic (Ctrl+I)' },
      { cmd: 'underline',   label: 'U',      cls: 'btn-underline', title: 'Underline (Ctrl+U)' },
      { cmd: 'strikeThrough', label: 'S̶',   cls: 'btn-strike',    title: 'Strikethrough' },
      'sep',
      { cmd: 'h1',   label: 'H1', cls: '', title: 'Heading 1' },
      { cmd: 'h2',   label: 'H2', cls: '', title: 'Heading 2' },
      { cmd: 'h3',   label: 'H3', cls: '', title: 'Heading 3' },
      'sep',
      { cmd: 'insertUnorderedList', label: '• List',   cls: '', title: 'Bullet list' },
      { cmd: 'insertOrderedList',   label: '1. List',  cls: '', title: 'Numbered list' },
      'sep',
      { cmd: 'blockquote',   label: '❝',      cls: '',         title: 'Blockquote' },
      { cmd: 'codeInline',   label: '`code`', cls: 'btn-mono', title: 'Inline code' },
      { cmd: 'codeBlock',    label: '</> Block', cls: 'btn-mono', title: 'Code block' },
      { cmd: 'hr',           label: '──',     cls: '',         title: 'Horizontal rule' },
      'sep',
      { cmd: 'createLink',   label: '🔗 Link',  cls: '', title: 'Insert link (Ctrl+K)' },
      { cmd: 'image',        label: '🖼 Image', cls: '', title: 'Insert image' },
    ]

    buttons.forEach(def => {
      if (def === 'sep') {
        const sep = document.createElement('div')
        sep.className = 'editor-sep'
        this.toolbar.appendChild(sep)
        return
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = def.label
      btn.title = def.title
      btn.className = 'editor-btn ' + def.cls
      btn.dataset.cmd = def.cmd
      btn.addEventListener('mousedown', e => {
        e.preventDefault()
        this._saveRange()
        this._handleCmd(def.cmd, btn)
      })
      this.toolbar.appendChild(btn)
    })

    // content
    this.content = document.createElement('div')
    this.content.className = 'editor-content'
    this.content.contentEditable = 'true'
    this.content.setAttribute('data-placeholder', 'Start writing your post…')
    this.content.setAttribute('spellcheck', 'true')

    this.content.addEventListener('input',  () => this.onChange(this.getHTML()))
    this.content.addEventListener('keyup',  () => { this._saveRange(); this._updateToolbarState() })
    this.content.addEventListener('mouseup',() => { this._saveRange(); this._updateToolbarState() })
    this.content.addEventListener('keydown', e => this._handleKeydown(e))

    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection()
      if (sel && sel.rangeCount && this.content.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        this._savedRange = sel.getRangeAt(0).cloneRange()
      }
    })

    // Add HTML toggle button at the end of toolbar
    const sepEnd = document.createElement('div')
    sepEnd.className = 'editor-sep'
    this.toolbar.appendChild(sepEnd)
    this.toolbar.appendChild(htmlBtn)

    // HTML source textarea (hidden by default)
    this._htmlView = document.createElement('textarea')
    this._htmlView.className = 'editor-html-view'
    this._htmlView.setAttribute('spellcheck', 'false')
    this._htmlView.setAttribute('placeholder', 'HTML source…')
    this._htmlView.style.display = 'none'
    this._htmlView.addEventListener('input', () => this.onChange(this.getHTML()))

    this._isHtmlMode = false

    this.container.appendChild(this.toolbar)
    this.container.appendChild(this.content)
    this.container.appendChild(this._htmlView)
    this._setupImageClick()
  }

  // ── HTML prettifier ────────────────────────────────────────

  _prettifyHtml (html) {
    const BLOCK = new Set([
      'address','article','aside','blockquote','canvas','dd','details','dialog',
      'div','dl','dt','fieldset','figcaption','figure','footer','form',
      'h1','h2','h3','h4','h5','h6','header','hgroup','li','main',
      'nav','ol','p','section','summary','table','tbody',
      'td','tfoot','th','thead','tr','ul'
    ])
    const SELF_CLOSE = new Set([
      'area','base','br','col','embed','hr','img','input',
      'link','meta','param','source','track','wbr'
    ])
    const PRESERVE = new Set(['pre','textarea','script','style'])

    const TAB = '  '
    let depth = 0
    let out = ''
    let preserveDepth = 0

    // Tokenise into tags and text — handle quoted attributes safely
    const parts = html.split(/(<(?:[^"'>]|"[^"]*"|'[^']*')*>)/g)

    parts.forEach(part => {
      if (!part) return

      if (part.charAt(0) === '<') {
        const isClose = part.charAt(1) === '/'
        const rawName = part.slice(isClose ? 2 : 1).split(/[\s/>]/)[0]
        const tagName = rawName.toLowerCase()
        const isSelfClose = SELF_CLOSE.has(tagName) || part.charAt(part.length - 2) === '/'
        const isBlock = BLOCK.has(tagName)
        const isPreserve = PRESERVE.has(tagName)

        // Inside a preserve block — emit verbatim
        if (preserveDepth > 0) {
          out += part
          if (isPreserve) {
            if (isClose) preserveDepth = Math.max(0, preserveDepth - 1)
            else if (!isSelfClose) preserveDepth++
          }
          return
        }

        if (isPreserve && !isClose && !isSelfClose) preserveDepth++

        if (isClose && isBlock) {
          depth = Math.max(0, depth - 1)
          out += '\n' + TAB.repeat(depth) + part
        } else if (isBlock && isSelfClose) {
          out += '\n' + TAB.repeat(depth) + part
        } else if (isBlock) {
          out += '\n' + TAB.repeat(depth) + part
          depth++
        } else {
          // inline tag — attach to current line
          out += part
        }
      } else {
        // Text node
        if (preserveDepth > 0) { out += part; return }
        const trimmed = part.replace(/[ \t\r\n]+/g, ' ').trim()
        if (!trimmed) return
        // If the previous output ended with a newline+indent, add indent for the text
        if (/\n\s*$/.test(out)) {
          out += TAB.repeat(depth) + trimmed
        } else {
          out += trimmed
        }
      }
    })

    return out.trim()
  }

  // ── HTML view toggle ───────────────────────────────────────

  _toggleHtmlView (btn) {
    if (!this._isHtmlMode) {
      // Switch to HTML mode
      this._htmlView.value = this._prettifyHtml(this.content.innerHTML)
      this.content.style.display = 'none'
      this._htmlView.style.display = 'block'
      this._htmlView.focus()
      this._isHtmlMode = true
      btn.classList.add('active')
      btn.title = 'Switch back to visual editor'
      // Disable all other toolbar buttons while in HTML mode
      this.toolbar.querySelectorAll('.editor-btn:not([data-cmd="toggleHtml"])').forEach(b => {
        b.disabled = true
        b.style.opacity = '0.35'
      })
    } else {
      // Switch back to visual mode
      this.content.innerHTML = this._htmlView.value
      this._htmlView.style.display = 'none'
      this.content.style.display = ''
      this.content.focus()
      this._isHtmlMode = false
      btn.classList.remove('active')
      btn.title = 'Toggle HTML source view'
      this.toolbar.querySelectorAll('.editor-btn:not([data-cmd="toggleHtml"])').forEach(b => {
        b.disabled = false
        b.style.opacity = ''
      })
      this.onChange(this.getHTML())
    }
  }

  // ── Image click toolbar ────────────────────────────────────

  _setupImageClick () {
    this.content.addEventListener('click', e => {
      if (e.target.tagName === 'IMG') {
        e.preventDefault()
        this._showImageToolbar(e.target)
      } else {
        this._hideImageToolbar()
      }
    })
    // Escape key dismisses toolbar
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._hideImageToolbar()
    })
  }

  _showImageToolbar (img) {
    this._hideImageToolbar()
    this._activeImg = img

    const toolbar = document.createElement('div')
    toolbar.id = 'poster-img-toolbar'
    toolbar.style.cssText = [
      'position:fixed;z-index:9999',
      'background:#1e293b;border-radius:8px',
      'padding:10px 12px;box-shadow:0 4px 24px rgba(0,0,0,.4)',
      'display:flex;flex-direction:column;gap:8px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'min-width:220px'
    ].join(';')

    // ── Width row ──
    const widthRow = this._makeRow('Width')
    const curW = img.style.width || ''
    ;['25%', '50%', '75%', '100%'].forEach(w => {
      const btn = this._toolbarBtn(w, curW === w || (w === '100%' && !curW))
      btn.addEventListener('click', e => {
        e.stopPropagation()
        img.style.width = w
        img.style.maxWidth = '100%'
        if (!img.style.float) { img.style.display = 'block' }
        widthRow.querySelectorAll('button').forEach(b => this._setBtnActive(b, false))
        this._setBtnActive(btn, true)
        this.onChange(this.getHTML())
      })
      widthRow.appendChild(btn)
    })
    toolbar.appendChild(widthRow)

    // ── Align row ──
    const alignRow = this._makeRow('Align')
    const curFloat = img.style.float || ''
    const curAlign = curFloat === 'left' ? 'left' : curFloat === 'right' ? 'right' : 'center'
    ;[['◀ Left', 'left'], ['■ Center', 'center'], ['Right ▶', 'right']].forEach(([label, align]) => {
      const btn = this._toolbarBtn(label, curAlign === align)
      btn.addEventListener('click', e => {
        e.stopPropagation()
        if (align === 'left') {
          img.style.float = 'left'
          img.style.marginLeft = '0'
          img.style.marginRight = '1em'
          img.style.display = ''
        } else if (align === 'right') {
          img.style.float = 'right'
          img.style.marginLeft = '1em'
          img.style.marginRight = '0'
          img.style.display = ''
        } else {
          img.style.float = ''
          img.style.marginLeft = 'auto'
          img.style.marginRight = 'auto'
          img.style.display = 'block'
        }
        alignRow.querySelectorAll('button').forEach(b => this._setBtnActive(b, false))
        this._setBtnActive(btn, true)
        this.onChange(this.getHTML())
      })
      alignRow.appendChild(btn)
    })
    toolbar.appendChild(alignRow)

    // ── Remove button ──
    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.textContent = '🗑 Remove image'
    removeBtn.style.cssText = [
      'padding:5px 10px;border-radius:5px;border:none;cursor:pointer',
      'font-size:12px;background:#7f1d1d;color:#fecaca;width:100%',
      'font-family:inherit;margin-top:2px'
    ].join(';')
    removeBtn.addEventListener('click', e => {
      e.stopPropagation()
      img.remove()
      this._hideImageToolbar()
      this.onChange(this.getHTML())
    })
    toolbar.appendChild(removeBtn)

    document.body.appendChild(toolbar)
    this._imgToolbar = toolbar
    this._positionToolbar(img)

    setTimeout(() => {
      this._imgToolbarHandler = (e) => {
        if (toolbar && !toolbar.contains(e.target) && e.target !== img) {
          this._hideImageToolbar()
        }
      }
      document.addEventListener('mousedown', this._imgToolbarHandler)
    }, 0)
  }

  _makeRow (label) {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:4px;align-items:center;'
    const lbl = document.createElement('span')
    lbl.textContent = label + ':'
    lbl.style.cssText = 'color:#94a3b8;font-size:11px;min-width:38px;'
    row.appendChild(lbl)
    return row
  }

  _toolbarBtn (text, active) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = text
    btn.style.cssText = [
      'padding:4px 8px;border-radius:4px;border:none;cursor:pointer',
      'font-size:11px;font-family:inherit',
      'color:#f1f5f9;white-space:nowrap'
    ].join(';')
    this._setBtnActive(btn, active)
    return btn
  }

  _setBtnActive (btn, active) {
    btn.style.background = active ? '#0891b2' : '#334155'
  }

  _positionToolbar (img) {
    const toolbar = this._imgToolbar
    if (!toolbar) return
    const rect = img.getBoundingClientRect()
    const tbH = toolbar.offsetHeight || 140
    const tbW = toolbar.offsetWidth || 220

    let top = rect.bottom + 8
    if (top + tbH > window.innerHeight - 10) top = rect.top - tbH - 8
    top = Math.max(10, top)

    let left = rect.left
    if (left + tbW > window.innerWidth - 10) left = window.innerWidth - tbW - 10
    left = Math.max(10, left)

    toolbar.style.top  = top  + 'px'
    toolbar.style.left = left + 'px'
  }

  _hideImageToolbar () {
    if (this._imgToolbar) {
      this._imgToolbar.remove()
      this._imgToolbar = null
    }
    if (this._imgToolbarHandler) {
      document.removeEventListener('mousedown', this._imgToolbarHandler)
      this._imgToolbarHandler = null
    }
    this._activeImg = null
  }

  // ── Keydown & command handlers ─────────────────────────────

  _handleKeydown (e) {
    if ((e.ctrlKey || e.metaKey)) {
      if (e.key === 'b') { e.preventDefault(); this._handleCmd('bold') }
      if (e.key === 'i') { e.preventDefault(); this._handleCmd('italic') }
      if (e.key === 'u') { e.preventDefault(); this._handleCmd('underline') }
      if (e.key === 'k') { e.preventDefault(); this._handleCmd('createLink') }
    }
    if (e.key === 'Tab') {
      const pre = this._closestBlock('PRE')
      if (pre) {
        e.preventDefault()
        document.execCommand('insertText', false, '    ')
      }
    }
  }

  _handleCmd (cmd, _btn) {
    this.content.focus()
    this._restoreRange()

    if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3') {
      this._toggleBlock(cmd)
    } else if (cmd === 'blockquote') {
      this._toggleBlock('blockquote')
    } else if (cmd === 'codeInline') {
      this._wrapInlineCode()
    } else if (cmd === 'codeBlock') {
      this._insertCodeBlock()
    } else if (cmd === 'hr') {
      document.execCommand('insertHorizontalRule', false, null)
    } else if (cmd === 'createLink') {
      this._promptLink()
    } else if (cmd === 'image') {
      this._saveRange()
      this.onImageRequest()
    } else {
      document.execCommand(cmd, false, null)
    }
    this.onChange(this.getHTML())
    this._updateToolbarState()
  }

  _toggleBlock (tag) {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    let node = range.commonAncestorContainer
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement

    let existing = null
    let cur = node
    while (cur && cur !== this.content) {
      if (cur.tagName && cur.tagName.toLowerCase() === tag) { existing = cur; break }
      cur = cur.parentElement
    }

    if (existing) {
      const p = document.createElement('p')
      while (existing.firstChild) p.appendChild(existing.firstChild)
      existing.replaceWith(p)
    } else {
      document.execCommand('formatBlock', false, '<' + tag + '>')
    }
    this.onChange(this.getHTML())
  }

  _wrapInlineCode () {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const selectedText = range.toString()
    if (!selectedText) return
    if (this._closestBlock('PRE')) return

    const code = document.createElement('code')
    code.textContent = selectedText
    range.deleteContents()
    range.insertNode(code)
    const newRange = document.createRange()
    newRange.setStartAfter(code)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
  }

  _insertCodeBlock () {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const selectedText = range.toString()

    const existingPre = this._closestBlock('PRE')
    if (existingPre) {
      const p = document.createElement('p')
      p.textContent = existingPre.textContent
      existingPre.replaceWith(p)
      this.onChange(this.getHTML())
      return
    }

    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = selectedText || '\n'
    pre.appendChild(code)

    range.deleteContents()
    range.insertNode(pre)
    const p = document.createElement('p')
    p.innerHTML = '<br>'
    pre.insertAdjacentElement('afterend', p)

    const newRange = document.createRange()
    newRange.setStart(code, 0)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
  }

  _promptLink () {
    const sel = window.getSelection()
    const existing = this._closestInline('A')
    const defaultUrl = existing ? existing.href : 'https://'

    const rect = (sel && sel.rangeCount)
      ? sel.getRangeAt(0).getBoundingClientRect()
      : { bottom: 100, left: 100 }

    const prompt = document.createElement('div')
    prompt.className = 'link-prompt'
    const input = document.createElement('input')
    input.type = 'text'
    input.value = defaultUrl
    input.placeholder = 'https://…'
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = 'btn btn-primary'
    ok.textContent = 'OK'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'btn btn-secondary'
    cancel.textContent = '✕'
    prompt.appendChild(input)
    prompt.appendChild(ok)
    prompt.appendChild(cancel)

    prompt.style.top  = (rect.bottom + window.scrollY + 6) + 'px'
    prompt.style.left = (rect.left + window.scrollX) + 'px'
    document.body.appendChild(prompt)
    input.focus()
    input.select()

    const close = () => { if (prompt.parentNode) prompt.parentNode.removeChild(prompt) }

    const apply = () => {
      const url = input.value.trim()
      close()
      this._restoreRange()
      this.content.focus()
      if (url) {
        document.execCommand('createLink', false, url)
        const links = this.content.querySelectorAll('a[href="' + url + '"]')
        links.forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer' })
      } else if (existing) {
        document.execCommand('unlink', false, null)
      }
      this.onChange(this.getHTML())
    }

    ok.addEventListener('click', apply)
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); apply() }
      if (e.key === 'Escape') { close() }
    })
    cancel.addEventListener('click', close)
    setTimeout(() => {
      document.addEventListener('mousedown', function handler (e) {
        if (!prompt.contains(e.target)) { close(); document.removeEventListener('mousedown', handler) }
      })
    }, 0)
  }

  // ── DOM helpers ────────────────────────────────────────────

  _closestBlock (tag) {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return null
    let node = sel.getRangeAt(0).commonAncestorContainer
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement
    while (node && node !== this.content) {
      if (node.tagName && node.tagName === tag) return node
      node = node.parentElement
    }
    return null
  }

  _closestInline (tag) {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return null
    let node = sel.getRangeAt(0).commonAncestorContainer
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement
    while (node && node !== this.content) {
      if (node.tagName && node.tagName === tag) return node
      node = node.parentElement
    }
    return null
  }

  _saveRange () {
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      this._savedRange = sel.getRangeAt(0).cloneRange()
    }
  }

  _restoreRange () {
    if (!this._savedRange) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(this._savedRange)
  }

  _updateToolbarState () {
    const cmdMap = {
      bold: 'bold', italic: 'italic',
      underline: 'underline', strikeThrough: 'strikethrough'
    }
    this.toolbar.querySelectorAll('.editor-btn').forEach(btn => {
      const cmd = btn.dataset.cmd
      if (cmdMap[cmd]) {
        btn.classList.toggle('active', document.queryCommandState(cmd))
      }
      if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3' || cmd === 'blockquote') {
        const val = document.queryCommandValue('formatBlock').toLowerCase()
        btn.classList.toggle('active', val === cmd || val === cmd.replace('h', 'heading '))
      }
      if (cmd === 'codeBlock') {
        btn.classList.toggle('active', !!this._closestBlock('PRE'))
      }
    })
  }

  // ── Public API ─────────────────────────────────────────────

  getHTML () {
    if (this._isHtmlMode) return this._htmlView.value
    return this.content.innerHTML
  }

  setHTML (html) {
    this.content.innerHTML = html || ''
    if (this._isHtmlMode) {
      this._htmlView.value = html || ''
    }
  }

  focus () { this.content.focus() }

  insertImageUrl (url) {
    this._restoreRange()
    this.content.focus()
    if (!this._savedRange) {
      const p = document.createElement('p')
      const img = document.createElement('img')
      img.src = url
      img.alt = ''
      img.style.maxWidth = '100%'
      p.appendChild(img)
      this.content.appendChild(p)
    } else {
      document.execCommand('insertHTML', false,
        '<img src="' + url.replace(/"/g, '&quot;') + '" alt="" style="max-width:100%">')
    }
    this.onChange(this.getHTML())
  }
}