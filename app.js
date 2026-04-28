/* global freezr, freezrMeta, PosterEditor */

// ── State ────────────────────────────────────────────────────
const App = {
  posts: [],          // local cache
  currentPost: null,  // { _id, title, body, labels, ... }
  editor: null,
  saveTimer: null,
  uploadedFileId: null,  // pending image file id from upload
  isSaving: false,
  isPublishing: false
}

// ── Image file tracking helpers ──────────────────────────────

const PRIVATE_IMG_PREFIX = '/feps/userfiles/' + freezrMeta.appName + '/' + freezrMeta.userId + '/'
const PUBLIC_IMG_PREFIX = '/@' + freezrMeta.userId + '/' + freezrMeta.appName + '.files/'

function extractImageFileIds (html) {
  if (!html) return []
  const div = document.createElement('div')
  div.innerHTML = html
  const ids = []
  div.querySelectorAll('img').forEach(img => {
    const src = (img.getAttribute('src') || '').split('?')[0]
    let id = null
    if (src.startsWith(PRIVATE_IMG_PREFIX)) {
      id = src.slice(PRIVATE_IMG_PREFIX.length)
    } else if (src.startsWith(PUBLIC_IMG_PREFIX)) {
      id = src.slice(PUBLIC_IMG_PREFIX.length)
    }
    if (id && !ids.includes(id)) ids.push(id)
  })
  return ids
}

function escapeRegex (str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rewriteToPublicUrls (html) {
  if (!html) return html
  return html.replace(new RegExp(escapeRegex(PRIVATE_IMG_PREFIX), 'g'), PUBLIC_IMG_PREFIX)
}

function rewriteToPrivateUrls (html) {
  if (!html) return html
  return html.replace(new RegExp(escapeRegex(PUBLIC_IMG_PREFIX), 'g'), PRIVATE_IMG_PREFIX)
}

// Delete orphaned images (those removed from the post body)
async function cleanupOrphanedImages (prevIds, currIds, publishedIds) {
  const removed = prevIds.filter(id => !currIds.includes(id))
  if (!removed.length) return

  const publishedSet = new Set(publishedIds || [])
  let warnCount = 0

  for (const id of removed) {
    if (publishedSet.has(id)) {
      warnCount++
      continue  // can't delete until unpublished
    }
    try {
      await freezr.deleteFile(id)
    } catch (e) {
      console.warn('Could not delete image file', id, e.message)
    }
  }

  if (warnCount) {
    notify(warnCount + ' image(s) are published — unpublish the post first to remove them.', 'error')
  }
}

// ── Init ─────────────────────────────────────────────────────
freezr.initPageScripts = async function () {
  App.editor = new PosterEditor(
    document.getElementById('editor-container'),
    {
      onChange: () => scheduleAutosave(),
      onImageRequest: () => openImageModal()
    }
  )

  attachListeners()
  await loadPosts()
  setStatus('Ready')
}

// ── Data / CRUD ──────────────────────────────────────────────
async function loadPosts () {
  try {
    const results = await freezr.query('posts', {}, { sort: { _date_modified: -1 }, count: 200 })
    App.posts = Array.isArray(results) ? results : []
    renderPostList()
  } catch (e) {
    console.error('loadPosts', e)
    notify('Could not load posts: ' + e.message, 'error')
  }
}

async function createPost () {
  try {
    const data = { title: '', body: '', labels: [], summaryText: '', mainimgurl: '' }
    const result = await freezr.create('posts', data)
    const post = Object.assign({}, data, result)
    App.posts.unshift(post)
    renderPostList()
    openPost(post)
  } catch (e) {
    notify('Could not create post: ' + e.message, 'error')
  }
}

async function saveCurrentPost (opts = {}) {
  const post = App.currentPost
  if (!post || App.isSaving) return
  App.isSaving = true
  setStatus('Saving…')

  const title  = document.getElementById('post-title').value.trim()
  const tags   = document.getElementById('post-tags').value.trim()
  const body   = App.editor.getHTML()
  const labels = tags ? tags.split(/\s+/).filter(Boolean) : []

  const prevPicts = post.picts || []
  const currPicts = extractImageFileIds(body)

  const changes = { title, body, labels, picts: currPicts }

  try {
    if (post._id) {
      await freezr.update('posts', post._id, changes)
    } else {
      const result = await freezr.create('posts', changes)
      post._id = result._id
    }
    Object.assign(post, changes)
    const idx = App.posts.findIndex(p => p._id === post._id)
    if (idx > -1) Object.assign(App.posts[idx], changes)
    else App.posts.unshift(post)

    renderPostList()
    renderMeta()
    setStatus(opts.explicit ? 'Saved' : 'Auto-saved')

    cleanupOrphanedImages(prevPicts, currPicts, post.publishedPicts || [])
  } catch (e) {
    setStatus('Save failed')
    notify('Save error: ' + e.message, 'error')
  } finally {
    App.isSaving = false
  }
}

async function deleteCurrentPost () {
  if (!App.currentPost || !App.currentPost._id) return
  if (!confirm('Delete this post? This cannot be undone.')) return

  try {
    await freezr.delete('posts', App.currentPost._id)
    App.posts = App.posts.filter(p => p._id !== App.currentPost._id)
    App.currentPost = null
    renderPostList()
    showEmptyState()
    notify('Post deleted')
  } catch (e) {
    notify('Delete failed: ' + e.message, 'error')
  }
}

// ── Open / render post ───────────────────────────────────────
function openPost (post) {
  clearTimeout(App.saveTimer)
  App.currentPost = post

  if (!post.picts) {
    post.picts = extractImageFileIds(post.body || '')
  }

  document.getElementById('no-post-selected').style.display = 'none'
  const editorEl = document.getElementById('post-editor')
  editorEl.style.display = 'flex'

  document.getElementById('post-title').value = post.title || ''
  document.getElementById('post-tags').value  = (post.labels || []).join(' ')
  App.editor.setHTML(post.body || '')
  App.editor.focus()

  renderMeta()
  updatePublishButtons()
  highlightSidebar(post._id)
}

function showEmptyState () {
  document.getElementById('no-post-selected').style.display = 'flex'
  document.getElementById('post-editor').style.display = 'none'
}

function renderMeta () {
  const post = App.currentPost
  if (!post) return
  const el = document.getElementById('post-meta')
  const pub = getPublishEntry(post)
  if (pub && pub.granted) {
    const dateStr = new Date(pub._date_published).toLocaleDateString()
    const url = '/' + pub.public_id
    el.innerHTML = 'Published ' + dateStr + ' · <a href="' + url + '" target="_blank">View public post ↗</a>'
  } else {
    const mod = post._date_modified
      ? 'Last saved ' + new Date(post._date_modified).toLocaleString()
      : 'Not yet saved'
    el.textContent = 'Draft · ' + mod
  }
}

function updatePublishButtons () {
  const post = App.currentPost
  if (!post) return
  const pub = getPublishEntry(post)
  const isPublished = !!(pub && pub.granted)
  document.getElementById('btn-unpublish').style.display = isPublished ? '' : 'none'
  document.getElementById('btn-publish').textContent     = isPublished ? 'Re-publish' : 'Publish'
}

// ── Sidebar list ─────────────────────────────────────────────
function renderPostList (filter) {
  const list = document.getElementById('posts-list')
  if (!App.posts.length) {
    list.innerHTML = '<div class="posts-empty">No posts yet. Click "+ New" to start.</div>'
    return
  }
  const q = (filter || document.getElementById('search-input').value || '').toLowerCase()
  const filtered = App.posts.filter(p =>
    !q ||
    (p.title  || '').toLowerCase().includes(q) ||
    (p.labels || []).join(' ').toLowerCase().includes(q)
  )
  if (!filtered.length) {
    list.innerHTML = '<div class="posts-empty">No posts match "' + q + '"</div>'
    return
  }
  list.innerHTML = filtered.map(p => {
    const pub = getPublishEntry(p)
    const isPublished = !!(pub && pub.granted)
    const dateStr = p._date_modified ? relativeDate(p._date_modified) : ''
    const active  = App.currentPost && App.currentPost._id === p._id ? ' active' : ''
    return (
      '<div class="post-item' + active + '" data-id="' + (p._id || '') + '">' +
        '<div class="post-item-title">' + escHtml(p.title || 'Untitled') + '</div>' +
        '<div class="post-item-meta">' +
          '<span class="post-status ' + (isPublished ? 'published' : 'draft') + '">' +
            (isPublished ? '● Published' : '○ Draft') +
          '</span>' +
          '<span class="post-date">' + dateStr + '</span>' +
        '</div>' +
      '</div>'
    )
  }).join('')
}

function highlightSidebar (id) {
  document.querySelectorAll('.post-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id)
  })
}

// ── Autosave ─────────────────────────────────────────────────
function scheduleAutosave () {
  clearTimeout(App.saveTimer)
  setStatus('Unsaved…')
  App.saveTimer = setTimeout(() => saveCurrentPost(), 3000)
}

// ── Publish ──────────────────────────────────────────────────
function openPublishModal () {
  const post = App.currentPost
  if (!post) return

  const pub = getPublishEntry(post)
  document.getElementById('publish-modal-title').textContent =
    (pub && pub.granted) ? 'Re-publish Post' : 'Publish Post'

  const currentBody = App.editor.getHTML() || ''

  document.getElementById('publish-summary').value =
    post.summaryText || stripTags(currentBody).slice(0, 300)
  document.getElementById('publish-image-url').value =
    post.mainimgurl || firstImageSrc(currentBody) || ''

  const now = new Date()
  const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16)
  document.getElementById('publish-date').value =
    (pub && pub._date_published)
      ? toDatetimeLocal(pub._date_published)
      : localISO

  document.getElementById('publish-status-msg').textContent = ''
  document.getElementById('publish-status-msg').className   = 'publish-status-msg'
  document.getElementById('btn-confirm-publish').disabled   = false

  document.getElementById('publish-modal').style.display = 'flex'
}

async function confirmPublish () {
  const post = App.currentPost
  if (!post || !post._id) {
    notify('Please save the post first.', 'error')
    return
  }

  const summary     = document.getElementById('publish-summary').value.trim()
  const mainimgurl  = document.getElementById('publish-image-url').value.trim()
  const pubDateVal  = document.getElementById('publish-date').value
  const pubDate     = pubDateVal ? new Date(pubDateVal).getTime() : Date.now()

  const statusEl = document.getElementById('publish-status-msg')
  statusEl.textContent = 'Publishing…'
  statusEl.className   = 'publish-status-msg'
  document.getElementById('btn-confirm-publish').disabled = true

  try {
    // 1. Save latest content first
    await saveCurrentPost()

    // 2. Update meta fields
    await freezr.update('posts', post._id, {
      title:        document.getElementById('post-title').value.trim(),
      body:         App.editor.getHTML(),
      labels:       (document.getElementById('post-tags').value.trim()).split(/\s+/).filter(Boolean),
      summaryText:  summary,
      mainimgurl:   mainimgurl,
      twitterCard:  mainimgurl ? 'summary_large_image' : 'summary'
    })

    // 3. Share each embedded image file publicly
    const bodyToPublish = App.editor.getHTML()
    const publishedImageIds = extractImageFileIds(bodyToPublish)
    const existingPublished = post.publishedPicts || []
    const mergedPublished = Array.from(new Set([...existingPublished, ...publishedImageIds]))

    for (const imageId of publishedImageIds) {
      try {
        await freezr.perms.shareRecords(imageId, {
          name:     'publish_images',
          table_id: 'com.salmanff.poster.files',
          grantees: ['_public'],
          action:   'grant',
          doNotList: true
        })
      } catch (e) {
        console.warn('Could not publish image', imageId, e.message)
      }
    }

    // 4. Rewrite body URLs to public form and save
    const publicBody = rewriteToPublicUrls(bodyToPublish)
    await freezr.update('posts', post._id, {
      body: publicBody,
      publishedPicts: mergedPublished
    })
    post.body = publicBody
    post.publishedPicts = mergedPublished
    App.editor.setHTML(publicBody)

    // 5. Share post publicly (server copies record with public URLs to public DB)
    const pub = getPublishEntry(post)
    const pid = pub && pub.public_id ? pub.public_id : null

    const shareResult = await freezr.perms.shareRecords(post._id, {
      name:     'publish_posts',
      table_id: 'com.salmanff.poster.posts',
      grantees: ['_public'],
      action:   'grant',
      publicid: pid || undefined,
      pubDate:  pubDate
    })

    // 5. Update local cache
    if (!post._accessibles) post._accessibles = []
    const idx = post._accessibles.findIndex(a => a.permission_name === 'publish_posts')
    const entry = {
      grantee:          '_public',
      permission_name:  'publish_posts',
      granted:          true,
      public_id:        shareResult.public_id || pid,
      _date_published:  pubDate
    }
    if (idx > -1) post._accessibles[idx] = entry
    else post._accessibles.push(entry)

    post.summaryText = summary
    post.mainimgurl  = mainimgurl

    statusEl.textContent = 'Published! ✓'
    statusEl.className   = 'publish-status-msg success'

    renderMeta()
    updatePublishButtons()
    renderPostList()

    setTimeout(() => closeModal('publish-modal'), 1200)
    notify('Post published successfully!', 'success')
  } catch (e) {
    console.error('publish', e)
    const msg = e.message || 'Unknown error'
    if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('grant')) {
      statusEl.textContent = 'Permission not granted. Go to Settings → App Permissions and grant "publish_posts", then try again.'
    } else {
      statusEl.textContent = 'Error: ' + msg
    }
    statusEl.className = 'publish-status-msg error'
    document.getElementById('btn-confirm-publish').disabled = false
  }
}

async function unpublishPost () {
  const post = App.currentPost
  if (!post || !post._id) return
  if (!confirm('Unpublish this post? It will no longer be publicly visible.')) return

  try {
    // Unshare each published image
    for (const imageId of (post.publishedPicts || [])) {
      try {
        await freezr.perms.shareRecords(imageId, {
          name:     'publish_images',
          table_id: 'com.salmanff.poster.files',
          grantees: ['_public'],
          action:   'deny'
        })
      } catch (e) {
        console.warn('Could not unpublish image', imageId, e.message)
      }
    }

    await freezr.perms.shareRecords(post._id, {
      name:     'publish_posts',
      table_id: 'com.salmanff.poster.posts',
      grantees: ['_public'],
      action:   'deny'
    })

    // Rewrite body URLs back to private form
    if (post.body) {
      const privateBody = rewriteToPrivateUrls(post.body)
      await freezr.update('posts', post._id, { body: privateBody, publishedPicts: [] })
      post.body = privateBody
      App.editor.setHTML(privateBody)
    } else {
      await freezr.update('posts', post._id, { publishedPicts: [] })
    }

    if (post._accessibles) {
      const idx = post._accessibles.findIndex(a => a.permission_name === 'publish_posts')
      if (idx > -1) post._accessibles[idx].granted = false
    }
    post.publishedPicts = []

    renderMeta()
    updatePublishButtons()
    renderPostList()
    notify('Post unpublished.')
  } catch (e) {
    notify('Unpublish failed: ' + e.message, 'error')
  }
}

// ── File name helpers ────────────────────────────────────────
function sanitizeFileName (name) {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : ''
  const base = dot > 0 ? name.slice(0, dot) : name
  const clean = base
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
  return (clean || 'image') + ext.toLowerCase()
}

function renameFile (file) {
  const safeName = sanitizeFileName(file.name)
  if (safeName === file.name) return file
  return new File([file], safeName, { type: file.type })
}

// ── Image modal ──────────────────────────────────────────────
function openImageModal () {
  App.uploadedFileId = null
  document.getElementById('upload-preview').innerHTML = ''
  document.getElementById('image-file-input').value = ''
  document.getElementById('image-url-input').value  = ''
  switchTab('upload')
  document.getElementById('image-modal').style.display = 'flex'
}

async function insertImage () {
  const activeTab = document.querySelector('.tab-btn.active').dataset.tab

  if (activeTab === 'url') {
    const url = document.getElementById('image-url-input').value.trim()
    if (!url) { notify('Please enter an image URL', 'error'); return }
    App.editor.insertImageUrl(url)
    closeModal('image-modal')
    return
  }

  // upload tab
  const rawFile = document.getElementById('image-file-input').files[0]
  if (!rawFile) { notify('Please choose a file', 'error'); return }

  document.getElementById('btn-insert-image').disabled = true
  document.getElementById('btn-insert-image').textContent = 'Uploading…'

  try {
    const file = renameFile(rawFile)
    const result = await freezr.upload(file)
    if (!result || !result._id) throw new Error('Upload failed')

    const url = freezr.utils.userFilePath(result._id)

    App.editor.insertImageUrl(url)
    closeModal('image-modal')
    scheduleAutosave()
    notify('Image inserted')
  } catch (e) {
    notify('Upload failed: ' + e.message, 'error')
  } finally {
    document.getElementById('btn-insert-image').disabled = false
    document.getElementById('btn-insert-image').textContent = 'Insert'
  }
}

function previewImageFile (file) {
  const reader = new FileReader()
  reader.onload = ev => {
    document.getElementById('upload-preview').innerHTML =
      '<img src="' + ev.target.result + '" alt="preview" style="max-width:100%;border-radius:6px;margin-top:8px">'
  }
  reader.readAsDataURL(file)
}

function switchTab (tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
  document.getElementById('img-tab-upload').style.display = tab === 'upload' ? 'flex' : 'none'
  document.getElementById('img-tab-url').style.display    = tab === 'url'    ? 'flex' : 'none'
}

// ── Helpers ──────────────────────────────────────────────────
function getPublishEntry (post) {
  if (!post || !post._accessibles) return null
  return post._accessibles.find(a => a.permission_name === 'publish_posts') || null
}

function setStatus (msg) {
  document.getElementById('status-text').textContent = msg
}

function closeModal (id) {
  document.getElementById(id).style.display = 'none'
}

function notify (msg, type) {
  const el = document.getElementById('notification')
  el.textContent = msg
  el.className   = 'notification' + (type ? ' ' + type : '')
  el.style.display = 'block'
  clearTimeout(App._notifyTimer)
  App._notifyTimer = setTimeout(() => { el.style.display = 'none' }, 3500)
}

function escHtml (str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function stripTags (html) {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || ''
}

function firstImageSrc (html) {
  const d = document.createElement('div')
  d.innerHTML = html
  const img = d.querySelector('img')
  return img ? (img.getAttribute('src') || '') : ''
}

function relativeDate (ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return mins + 'm ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return hrs + 'h ago'
  const days = Math.floor(hrs / 24)
  if (days < 7)   return days + 'd ago'
  return new Date(ts).toLocaleDateString()
}

function toDatetimeLocal (ts) {
  const d = new Date(ts)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// ── Event listeners ──────────────────────────────────────────
function attachListeners () {
  // sidebar toggle
  document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('hidden')
  })

  // new post
  document.getElementById('btn-new-post').addEventListener('click', createPost)

  // save
  document.getElementById('btn-save').addEventListener('click', () => saveCurrentPost({ explicit: true }))

  // delete
  document.getElementById('btn-delete').addEventListener('click', deleteCurrentPost)

  // publish / unpublish
  document.getElementById('btn-publish').addEventListener('click', openPublishModal)
  document.getElementById('btn-unpublish').addEventListener('click', unpublishPost)

  // title / tags → trigger autosave
  document.getElementById('post-title').addEventListener('input', scheduleAutosave)
  document.getElementById('post-tags').addEventListener('input', scheduleAutosave)

  // sidebar post click
  document.getElementById('posts-list').addEventListener('click', e => {
    const item = e.target.closest('.post-item')
    if (!item) return
    const id   = item.dataset.id
    const post = App.posts.find(p => p._id === id)
    if (post) openPost(post)
  })

  // search
  document.getElementById('search-input').addEventListener('input', e => {
    renderPostList(e.target.value)
  })

  // image modal
  document.getElementById('image-modal-backdrop').addEventListener('click', () => closeModal('image-modal'))
  document.getElementById('btn-cancel-image').addEventListener('click', () => closeModal('image-modal'))
  document.getElementById('btn-insert-image').addEventListener('click', insertImage)

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })

  document.getElementById('image-file-input').addEventListener('change', e => {
    const file = e.target.files[0]
    if (file) previewImageFile(file)
  })

  // drag-and-drop on the drop zone
  const dropZone = document.querySelector('.file-drop-zone')
  dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over')
  })
  dropZone.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) {
      notify('Please drop an image file', 'error')
      return
    }
    const input = document.getElementById('image-file-input')
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    previewImageFile(file)
  })

  // publish modal
  document.getElementById('publish-modal-backdrop').addEventListener('click', () => closeModal('publish-modal'))
  document.getElementById('btn-cancel-publish').addEventListener('click', () => closeModal('publish-modal'))
  document.getElementById('btn-confirm-publish').addEventListener('click', confirmPublish)

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      saveCurrentPost({ explicit: true })
    }
    if (e.key === 'Escape') {
      closeModal('image-modal')
      closeModal('publish-modal')
    }
  })
}