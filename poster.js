
// poster.js - a freezr app by sf v2018-07 - slightly updated 2022
/* global freezr, freezrMeta, JLOS, pell, confirm, location, alert  */

// poster Version = '0.111'

var poster
var editor
var currPostPointer = null
var stats = {
  // miscellaneous vars
  postIsInEditMode: false,
  warningTimeOut: null,
  syncInProgress: false,
  startTouch: { id: null, startX: 0, startY: 0, moveX: 0, moveY: 0 },
  syncCounter: 1,
  filterPublished: 'all'
}
const SAVES_PER_SYNC = 10
const NUM_NOTES_TO_DOWNLOAD = 20

freezr.initPageScripts = function () {
  poster = new JLOS('poster', {
    valueAtInit: {
      max_post_to_keep: 20,
      last_server_sync_time: 0,
      fj_oldest_item: null,
      fj_local_id_counter: 1,
      freezrMeta: { userId: freezrMeta.userId },
      posts: []
      // list of json of latest posts including server_version_details
      // {
      // 'title':null,
      // 'labels':null,
      // 'body':null,
      // 'created_locally': // used for pre-sync etc
      // 'deleted':false,
      // 'cipher': holding all encryptiond ata if post is encrypted
      // 'headers': generated automatically - list of title and labels
      // 'fj_local_temp_unique_id':null,
      // 'fj_modified_locally':null, // null if has not been modified
      // '_date_modified':0,
      // 'fj_device_modified_on':null //,
    },
    addConflistAsNew: null,
    handleConflictedItem: handleConflictedPost,
    saver: 'nosave'
  })

  // import { exec, init } from 'pell'
  editor = pell.init({
    element: document.getElementById('pell-editor'),
    onChange: html => {
      // document.getElementById('html-output').textContent = html
    },
    defaultParagraphSeparator: 'p',
    styleWithCSS: true,
    actions: [
      'bold',
      'underline',
      {
        name: 'italic',
        result: () => pell.exec('italic')
      },
      /*
      {
        name: 'custom',
        icon: '<b><u><i>C</i></u></b>',
        title: 'Custom Action',
        result: () => console.log('YOLO')
      },
      */
      {
        name: 'image',
        result: () => openDialogue('insertImage')
      },
      {
        name: 'link',
        result: () => {
          const url = window.prompt('Enter the link URL')
          if (url) pell.exec('createLink', url)
        }
      }
    ],
    classes: {
      actionbar: 'pell-actionbar-custom-name',
      button: 'pell-button-custom-name',
      content: 'pell-content-custom-name',
      selected: 'pell-button-selected-custom-name'
    }
  })
  // editor.content.innerHTML = '<b><u><i>Initial content!</i></u></b>'
  editor.content.setAttribute('data-placeholder', 'Start typing your blog post here')
  editor.content.style.marginTop = '5px'

  document.getElementById('titleDiv').onkeyup = resetTestBoxSize
  document.addEventListener('click', function (evt) {
    const parts = evt.target.id.split('_')
    if (parts && parts.length > 1 && parts[0] === 'click') { doClick[parts[1]](parts) }
  })
  document.addEventListener('dblclick', function (evt) {
    if (document.getElementById('pubView').style.display === 'none' && evt.target.tagName === 'IMG' && evt.target.src !== '/app_files/info.freezr.public/static/freezer_log_top.png') openDialogue('formatImage', { el: evt.target })
  })
  document.addEventListener('keyup', function (evt) {
    if (document.getElementById('click_dialogueBackGround').style.display === 'block' && evt.keyCode === 27) document.getElementById('click_dialogueBackGround').style.display = 'none'
  })
  document.getElementById('searchBoxDiv').onkeypress = function (evt) {
    if (evt.keyCode === 13 || evt.keyCode === 32) {
      if (evt.keyCode === 13) evt.preventDefault()
      populateLeftPanel()
    }
  }

  document.getElementById('radioShow_Drafts').onclick = function () { stats.filterPublished = 'drafts'; populateLeftPanel() }
  document.getElementById('radioShow_Pub').onclick = function () { stats.filterPublished = 'pub'; populateLeftPanel() }
  document.getElementById('radioShow_all').onclick = function () { stats.filterPublished = 'all'; populateLeftPanel() }

  document.getElementById('titleDiv').onpaste = pasteAsText
  document.getElementById('labelDiv').onpaste = pasteAsText
  document.getElementById('searchBoxDiv').onpaste = pasteAsText
  document.getElementById('dialogue_inputText').onpaste = pasteAsText

  resetSizes()
  captureEditorRangeData()

  var wrongId = false
  if (poster.data.freezrMeta && freezrMeta.userId !== poster.data.freezrMeta.userId) {
    if (confirm('There is data from another user on your device. If you press okay, that data will be deleted.')) {
      poster.reInitializeData()
      poster.data.freezrMeta = freezrMeta
      poster.save()
      location.reload()
    } else {
      wrongId = true
      window.open('/')
    }
  }
  if (!wrongId) {
    doSyncPosts(function () {
      syncEndCB()

      document.getElementById('pubOrDraftOuter').style.display = 'block'
      document.getElementById('searchOuter').style.display = 'block'
      document.getElementById('leftPostsList').style.display = 'block'
      document.getElementById('listingTopButts').style.display = 'block'
      document.getElementById('startsyncloader').style.display = 'none'

      if (poster.data.posts.length === 0) {
        toggleLeftMenu(true)
        doClick.newPost()
      } else if (poster.data.posts.length === 1 && isEmptyPost(poster.data.posts[0])) {
        toggleLeftMenu(true)
        doClick.gotoPost(('click_gotoPost_local_' + poster.data.posts[0].fj_local_temp_unique_id + '_title').split('_'))
      } else {
        toggleLeftMenu(false)
      }
    })
  }
  window.onfocus = function () { doSyncPosts() }
  freezr.utils.refreshFileTokens('IMG', 'src')
}

// POSTS
var saveOrRemoveEmptyPost = function () {
  // if in edit mode...
  if (!stats.postIsInEditMode) {
    // do nothing
  } else if ((currPostPointer.fj_local_temp_unique_id === poster.data.posts[poster.data.posts.length - 1].fj_local_temp_unique_id) && // ie it is the last post
    (!currPostPointer._id) &&
    (document.getElementById('titleDiv').innerText.trim() === '') &&
    (document.getElementById('labelDiv').innerText.trim() === '') &&
    (editor.content.innerText.trim() === '')
  ) {
    poster.data.posts.pop()
    currPostPointer = null
  } else {
    savePost()
  }
}
var savePost = function (forceSaveAndSync) {
  if (currPostPointer) {
    const publishStat = getPublishStats(currPostPointer)

    const titleFromHTML = document.getElementById('titleDiv').innerText.trim()
    const theLabelText = removeSpaces(document.getElementById('labelDiv').innerText)
    const bodyFromHTML = editor.content.innerHTML

    const bodyChanged = (currPostPointer.body !== bodyFromHTML)
    const titleChanged = (currPostPointer.title !== titleFromHTML)
    const labelsChanged = (currPostPointer.labels.join(' ') !== theLabelText)

    if (titleChanged || bodyChanged || labelsChanged || forceSaveAndSync) {
      if (bodyChanged) currPostPointer.body = bodyFromHTML
      if (titleChanged) currPostPointer.title = titleFromHTML
      if (labelsChanged) currPostPointer.labels = (theLabelText ? theLabelText.split(' ') : [])
      currPostPointer.fj_modified_locally = new Date().getTime()
      if (publishStat._date_published) {
        if (!currPostPointer.editedPostPublish) redoMenus()
        currPostPointer.editedPostPublish = true
      }
      poster.save()
      showCurrentPostStats()

      if ((forceSaveAndSync || stats.syncCounter >= SAVES_PER_SYNC)) {
        setTimeout(function () { doSyncPosts() }, 100) // timeout used so when savepost is called then sync then publish it does it in the right sequence
      } else {
        stats.syncCounter++
      }
    }
  } else {
    // no currPostPointer means just started
  }
}
var newPost = function () {
  currPostPointer = poster.add('posts', {
    title: '',
    labels: [],
    body: '',
    unpublished: null,
    created_locally: new Date().getTime()
  })
}
var isEmptyPost = function (aPost) {
  return ((aPost.body.trim() === '') &&
    (aPost.title.trim() === '') &&
    (aPost.labels.length === 0)
  )
}
var nowDate = function () {
  const now = new Date()
  return now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate()
}
var getSuggestedId = function () {
  const RANDOM_WORD_LEN = 8
  let title = currPostPointer.title + ' '
  title = title.replace(/-/g, '').replace(/\//g, '').replace(/\?/g, '').replace(/'/g, '').replace(/"/g, '').replace(/\s{2,}/g, ' ').trim()
  let parts = title.split(' ')
  parts = parts.slice(0, RANDOM_WORD_LEN - 1)
  title = parts.join('-')
  title = nowDate() + '-' + title
  if (!freezrMeta.adminUser) title = '@' + freezrMeta.userId + '/' + title
  return title
}

// publishing post
const HOSTSERVER = encodeURI(window.location.protocol + '//' + window.location.hostname + (window.location.port ? (':' + window.location.port) : ''))
const PRIVATE_PICT_MID_URL = '/feps/userfiles/com.salmanff.poster'
const PUBLIC_PICT_MID_URL = '/v1/publicfiles/com.salmanff.poster'
const isPrivatePict = (url) => startsWith(url, (HOSTSERVER + PRIVATE_PICT_MID_URL))
const isPublicPict = (url) => startsWith(url, (HOSTSERVER + PUBLIC_PICT_MID_URL))
const isPosterLink = (url) => (isPrivatePict(url) || isPublicPict(url))
var getAllPostPictDivs = function () {
  const imgList = document.getElementsByTagName('IMG')
  const pictList = []
  Array.prototype.forEach.call(imgList, function (anImg) {
    if (isPosterLink(anImg.src) && anImg.className !== 'imageChooser') pictList.push(anImg)
  })
  return pictList
}
var prevUnPublishDate
var prepareToPublishOrUnpublish = function (doPublish, pid) {
  // onsole.log('prepareToPublishOrUnpublish ', { doPublish, pid, currPostPointer })
  if (stats.syncInProgress) {
    showWarning('Please wait a second and try again. Posts are syncing.', 1000)
    openDialogue('publishStep4')
  } else {
    currPostPointer.summaryText = postToPublishStatus.summaryText
    currPostPointer.mainimgurl = postToPublishStatus.mainimgurl
    currPostPointer.mainimgtxt = postToPublishStatus.mainimgtxt
    currPostPointer.twitterCard = postToPublishStatus.twitterCard

    prevUnPublishDate = currPostPointer.unpublished ? (0 + currPostPointer.unpublished) : null
    currPostPointer.unpublished = doPublish ? null : new Date().getTime()
    savePost()

    // should also add all the picts in currPostPointer.picts
    if (!postToPublishStatus.imgList || postToPublishStatus.imgList.length === 0) {
      nowPublishOrUnpublishCurrentPost(doPublish, pid, currPostPointer)
    } else {
      publishPictsThenPost(doPublish, pid, currPostPointer)
    }
  }
}
const publishPictsThenPost = function (doPublish, pid, currPostPointer) {
  const options = {
    action: 'grant',
    grantees: ['_public'],
    table_id: 'com.salmanff.poster.files',
    doNotList: true,
    name: 'publish_picts'
  }
  const pictIds = postToPublishStatus.imgList.map(getFileIdFromImgDiv)

  if (pictIds && pictIds.length > 0) {
    freezr.perms.shareRecords(pictIds, options, function (err, returndata) {
      var d = freezr.utils.parse(returndata)
      if (err) d = { error: err.message }
      if (!d) d = { issues: 'No message from server.', error: 'No message from server.' }
      if (d.issues && d.issues.length > 0) console.warn('INTERNAL ERROR: ' + d.issues)
      if (d.err || d.error) {
        showWarning('Error syncing / publishing pictures - ' + d.error, 10000)
        savePost()
        closeDialogue()
        redoMenus()
      } else {
        if (doPublish) {
        // let addhost = startsWith(currPostPointer.mainimgurl,window.location.protocol)? window.location.protocol+"//"+window.location.hostname+(window.location.port? (":"+window.location.port):""): ""
        // console.log("changing addhost "+addhost) // 2021 what was this for? console.log
          currPostPointer.mainimgurl = postToPublishStatus.mainimgurl
        }
        postToPublishStatus.imgList.forEach(anImg => {
          if (doPublish) {
            // @nonadmin/com.salmanff.poster.files/cheese%2002.png
            // '/feps/userfiles/com.salmanff.poster'
            anImg.src = anImg.src.replace(PRIVATE_PICT_MID_URL + '/' + freezrMeta.userId, ('/@' + freezrMeta.userId + '/com.salmanff.poster.files')).split('?')[0]
          } else {
            anImg.src = anImg.src.replace(('@' + freezrMeta.userId + '/com.salmanff.poster.files'), PRIVATE_PICT_MID_URL + '/' + freezrMeta.userId)
            freezr.utils.refreshFileTokens()
          }
        })
        savePost()
        alert('then going to post')
      // nowPublishOrUnpublishCurrentPost(doPublish, pid, currPostPointer)
      }
    })
  } else {
    nowPublishOrUnpublishCurrentPost(doPublish, pid, currPostPointer)
  }
}
var nowPublishOrUnpublishCurrentPost = function (doPublish, pid, postPointer) {
  if (stats.syncInProgress) {
    showWarning('Please wait a second and try again. Posts are syncing.', 1000)
    openDialogue('publishStep4')
  } else {
    doSyncPosts(function (aMsg) {
      syncEndCB()
      // bug  - if error was received on an item after the curr_post is publidhed, then there will be a mismatch on what is marked published on server and locally
      if (aMsg && (aMsg.error || aMsg.err)) {
        postPointer.unpublished = prevUnPublishDate
        showWarning('The post could not be published because of an error -' + (aMsg.error || aMsg.err))
      } else if (!postPointer._id) {
        postPointer.unpublished = prevUnPublishDate
        showWarning('The post was not published, due to a timing error.')
      } else {
        const publishStat = getPublishStats(postPointer)
        pid = publishStat.public_id || pid
        var options = {
          action: (doPublish ? 'grant' : 'deny'),
          publicid: pid,
          pubDate: postToPublishStatus.pubDate,
          grantees: ['_public'],
          table_id: 'com.salmanff.poster.posts',
          name: 'publish_posts'
        }
        freezr.perms.shareRecords(postPointer._id, options, function (err, returndata) {
          var d = freezr.utils.parse(returndata)
          console.log('returndata' , { d })
          if (err) d = { error: err.message, issues: err.message }
          if (d && d.issues && d.issues.length > 0) console.warn('INTERNAL ERROR: ' + d.issues)
          if (!d || d.err || d.error) {
            postPointer.unpublished = prevUnPublishDate
            showWarning('Error reaching freezr - ' + (d ? d.error : 'unknown'), 10000)
            savePost()
            closeDialogue()
            redoMenus()
          } else {
            postPointer.editedPostPublish = false
            if (!postPointer._accessible) postPointer._accessible = {}
            if (!postPointer._accessible._public) postPointer._accessible._public = {}
            if (!postPointer._accessible._public['com_salmanff_poster/publish_posts']) postPointer._accessible._public['com_salmanff_poster/publish_posts'] = { }
            postPointer._accessible._public['com_salmanff_poster/publish_posts'] = {
              granted: true,
              public_id: pid,
              _date_published: d._date_published
            }
            showCurrentPost()

            savePost()
            closeDialogue()
            redoMenus()

            showWarning((doPublish ? 'SUCCESS PUBLISHING POST' : 'SUCCESS UNPUBLISHING POST'), 10000)

            doSyncPosts()
          }
        })
      }
    })
  }
}

var postToPublishStatus = {}
var initPostToPublishStatus = function () {
  const publishStat = getPublishStats(currPostPointer)
  postToPublishStatus = {}
  postToPublishStatus.summaryText = currPostPointer.summaryText || summariseText(currPostPointer.body)
  postToPublishStatus.pubDate = publishStat._date_published || (new Date().getTime())
  postToPublishStatus.imgList = getAllPostPictDivs()
  postToPublishStatus.mainimgurl = currPostPointer.mainimgurl || (postToPublishStatus.imgList && postToPublishStatus.imgList.length > 0 ? postToPublishStatus.imgList[0].src : null)
  postToPublishStatus.mainimgtxt = currPostPointer.mainimgtxt || (postToPublishStatus.imgList && postToPublishStatus.imgList.length > 0 ? getFileIdFromImgDiv(postToPublishStatus.imgList[0]) : null)
  // onsole.log('filename from div',postToPublishStatus.imgList[0],getFileIdFromImgDiv(postToPublishStatus.imgList[0]))
}
var summariseText = function (htmlText) {
  const ARBITRARY_MAX_LENGTH = 500
  const el = document.createElement('div')
  el.innerHTML = htmlText
  return el.innerText.slice(0, ARBITRARY_MAX_LENGTH)
  // let inner = el.innerText
  // if (inner.length<ARBITRARY_MAX_LENGTH) return inner
  // return inner.slice(0,ARBITRARY_MAX_LENGTH)
}

var deletePost = function () {
  console.log('to do')
  alert('to do')
}
// showing panels and rendering data

// VIEW MAIN Rendering (Show / Hide Eements)
var clearPostFields = function () {
  // alert('new post')
  const theDivs = ['titleDiv', 'labelDiv', 'searchBoxDiv', 'postMetaDiv']
  theDivs.forEach(function (aDiv) { document.getElementById(aDiv).innerHTML = '' })
  editor.content.innerHTML = ''
}
var showCurrentPost = function (view) {
  clearPostFields()
  document.getElementById('writingDiv').scrollTop = 0

  if (!currPostPointer) {
    showWarning('Internal Error - Could not show post')
  } else if (currPostPointer.fj_deleted) {
    showWarning('This post has been deleted.')
    toggleLeftMenu(false)
    currPostPointer = null
  } else { // ALL NORMAL CASES
    const publishStat = getPublishStats(currPostPointer)

    if (!view) view = (publishStat._date_published && !currPostPointer.editedPostPublish) ? 'pub' : 'edit'
    document.getElementById('titleDiv').innerText = currPostPointer.title
    document.getElementById('labelDiv').innerText = currPostPointer.labels.join(' ').trim()
    editor.content.innerHTML = currPostPointer.body

    document.getElementById('click_unpublish_0').style.display = publishStat.public_id ? 'block' : 'none'
    document.getElementById('click_unpublish_1').style.display = publishStat.public_id ? 'block' : 'none'
    document.getElementById('click_publish_0').style.display = (publishStat._date_published < currPostPointer._date_modified) ? 'none' : 'block'
    document.getElementById('click_publish_1').style.display = (publishStat._date_published < currPostPointer._date_modified) ? 'none' : 'block'

    showWarning()
    redoMenus()
    if (view === 'edit') {
      document.getElementById('editView').style.display = 'block'
      document.getElementById('pubView').style.display = 'none'
      stats.postIsInEditMode = true
    } else if (view === 'pub') {
      document.getElementById('editView').style.display = 'none'
      document.getElementById('pubView').style.display = 'block'
      document.getElementById('pubViewTitle').innerText = currPostPointer.title
      document.getElementById('pubViewLabels').innerText = currPostPointer.labels.length > 0 ? ('Labels: ' + currPostPointer.labels.join(', ').trim()) : ' '
      document.getElementById('pubViewBody').innerHTML = currPostPointer.body
    }
    showCurrentPostStats()
    freezr.utils.refreshFileTokens('IMG', 'src')
    resetSizes()
  }
}
const redoMenus = function () {
  if (currPostPointer) {
    let numPicts = 2
    const showText = (window.innerWidth > 650)
    const publishStat = getPublishStats(currPostPointer)

    showDiv('click_menu_1', (showText), 'inline-block')
    showDiv('click_chgView_1', (showText), 'inline-block')
    showDiv('click_unpublish_1', (showText), 'inline-block')

    showDiv('click_unpublish_0', publishStat._date_published, 'inline-block')
    showDiv('click_unpublish_1', (showText && publishStat._date_published), 'inline-block')
    numPicts += (publishStat._date_published ? 1 : 0)

    showDiv('click_publish_0', (!publishStat._date_published || currPostPointer.editedPostPublish || currPostPointer.unpublished), 'inline-block')
    showDiv('click_publish_1', (showText && !publishStat._date_published && !currPostPointer.unpublished), 'inline-block')
    showDiv('click_publish_2', (showText && (currPostPointer.editedPostPublish || currPostPointer.unpublished)), 'inline-block')
    numPicts += ((!publishStat._date_published || currPostPointer.editedPostPublish || currPostPointer.unpublished) ? 1 : 0)

    showDiv('click_save_0', (document.getElementById('pubView').style.display === 'none'), 'inline-block')
    showDiv('click_save_1', (showText && document.getElementById('pubView').style.display === 'none'), 'inline-block')
    numPicts += (document.getElementById('pubView').style.display === 'none') ? 1 : 0

    showDiv('click_delete_0', (!publishStat._date_published), 'inline-block')
    showDiv('click_delete_1', (showText && !publishStat._date_published), 'inline-block')
    numPicts += (!publishStat._date_published) ? 1 : 0

    const xMargin = (Math.min(800, window.innerWidth) - 10 - (numPicts * (showText ? 110 : 70))) / (numPicts - 1)
    document.getElementById('click_chgView_0').style.marginLeft = xMargin + 'px'
    document.getElementById('click_save_0').style.marginLeft = xMargin + 'px'
    document.getElementById('click_delete_0').style.marginLeft = xMargin + 'px'
    const partPubAdj = (publishStat._date_published && !currPostPointer.editedPostPublish && !currPostPointer.unpublished)
    document.getElementById('click_unpublish_0').style.marginLeft = (partPubAdj ? 0 : xMargin) + 'px'
    document.getElementById('click_unpublish_0').style.float = partPubAdj ? 'right' : null
    document.getElementById('click_unpublish_1').style.float = partPubAdj ? 'right' : null
  }
}
var showDiv = function (aDiv, doShow, blockstyle) {
  blockstyle = blockstyle || 'block'
  if (document.getElementById(aDiv))document.getElementById(aDiv).style.display = doShow ? blockstyle : 'none'
}
var showCurrentPostStats = function () {
  //
  document.getElementById('postMetaDiv').innerHTML = statsInText(currPostPointer)
}
var statsInText = function (aRecord) {
  const publishStat = getPublishStats(aRecord)
  var temptext = ''
  temptext += (publishStat.granted && publishStat._date_published) ? ('Published on ' + freezr.utils.longDateFormat(publishStat._date_published) + ' <a href="/' + publishStat.public_id + '" target="_blank">(View)</a>') : (aRecord.unpublished ? ('UNpublished on ' + freezr.utils.longDateFormat(aRecord.unpublished)) : 'Unpublished')
  temptext += (aRecord.fj_modified_locally) ? ' - Modified recently (unsynced)' : (aRecord._date_modified ? ' - Last Modified: ' + freezr.utils.longDateFormat(aRecord._date_modified) : '')
  temptext += aRecord.created_locally ? (' - Created:' + freezr.utils.longDateFormat(aRecord.created_locally)) : ' - Creation: unknown'
  return temptext
}
const getPublishStats = function (aRecord) {
  // onsole.log((aRecord && aRecord._accessible && aRecord._accessible._public && aRecord._accessible._public['com_salmanff_poster/publish_posts']) ? aRecord._accessible._public['com_salmanff_poster/publish_posts'] : {})
  return (aRecord && aRecord._accessible && aRecord._accessible._public && aRecord._accessible._public['com_salmanff_poster/publish_posts']) ? aRecord._accessible._public['com_salmanff_poster/publish_posts'] : {}
}
const isPublic = function (aRecord) {
  return getPublishStats(aRecord).granted
}
// leftmenu
var toggleLeftMenu = function (doHide) {
  document.getElementById('click_menuBackGround').style.display = (doHide ? 'none' : 'block')
  const menuWidth = Math.min(500, window.innerWidth)
  document.getElementById('leftBar').style['-webkit-transform'] = 'translate3d(' + (doHide ? ('-' + (menuWidth + 20) + 'px') : '0') + ', 0, 0)'
  document.getElementById('leftBar').style.width = menuWidth + 'px'
  document.getElementById('writingTopButtsInner').style.display = (doHide ? 'block' : 'none')
  if (!doHide) document.getElementById('leftBar').scrollTop = 0
  if (!doHide) populateLeftPanel()
}
var leftMenuIsShowing = function () {
  //
  return document.getElementById('click_menuBackGround').style.display === 'block'
}

// VIEW Left Panel
var populateLeftPanel = function () {
  // onsole.log('#populateLeftPanel')
  const postsDiv = document.getElementById('leftPostsList')
  const searchWords = document.getElementById('searchBoxDiv').innerText.trim().toLowerCase().split(' ')
  if (poster.data.posts && poster.data.posts.length > 0) {
    postsDiv.innerHTML = 'All Posts' // todo - change to 'searched posts' or 'published posts' etc
    poster.data.posts = poster.data.posts.sort(sortByModDate)

    let foundOne = 0
    poster.data.posts.forEach(aPost => {
      let hasWords = true
      searchWords.forEach((aSearchWord) => {
        if (stats.filterPublished !== 'all') {
          if (stats.filterPublished === 'drafts' && isPublic(aPost)) hasWords = false
          if (stats.filterPublished === 'pub' && !isPublic(aPost)) hasWords = false
        }
        if (hasWords === true &&
        aPost.title.toLowerCase().indexOf(aSearchWord) < 0 &&
        aPost.body.toLowerCase().indexOf(aSearchWord) < 0 &&
        aPost.labels.join(' ').toLowerCase().indexOf(aSearchWord) < 0) hasWords = false
      })
      if (hasWords) { postsDiv.appendChild(leftPanelView(aPost)); foundOne++ }
    })
    if (!foundOne) postsDiv.innerHTML = 'No Posts Found<br>'
  } else {
    postsDiv.innerHTML = 'No posts. Press on the plus button to create a new post'
  }
}
var leftPanelView = function (aPost) {
  var noteWrap, noteTitleInList, noteLabelsInList, noteTextInList, noteDateInList

  const postType = aPost._date_modified ? 'online' : 'local'
  const postId = aPost._date_modified ? aPost._id : aPost.fj_local_temp_unique_id

  noteWrap = document.createElement('div')
  noteWrap.className = 'postListItem' + (aPost._date_published ? ' publishedText' : '') + ((currPostPointer && (postId === currPostPointer._id || postId === currPostPointer.fj_local_temp_unique_id)) ? ' postIsShowing' : '')
  noteWrap.id = 'click_gotoPost_' + postType + '_' + postId + '_wrap'

  noteTitleInList = document.createElement('div')
  noteTitleInList.className = 'leftBarTitle' + ((currPostPointer && (postId === currPostPointer._id || postId === currPostPointer.fj_local_temp_unique_id)) ? ' postIsShowing' : '')
  noteTitleInList.id = 'click_gotoPost_' + postType + '_' + postId + '_title'
  noteTitleInList.innerHTML = (aPost && aPost.title) ? aPost.title : 'No title'

  noteTextInList = document.createElement('div')
  noteTextInList.className = 'leftBarText' + ((currPostPointer && (postId === currPostPointer._id || postId === currPostPointer.fj_local_temp_unique_id)) ? ' postIsShowing' : '')
  noteTextInList.id = 'click_gotoPost_' + postType + '_' + postId + '_text'
  noteTextInList.innerHTML = (aPost && aPost.body) ? aPost.body : ' - '
  noteTextInList.innerHTML = noteTextInList.innerText

  noteLabelsInList = document.createElement('div')
  noteLabelsInList.className = 'leftBarLabels'
  noteLabelsInList.id = 'click_gotoPost_' + postType + '_' + postId + '_labels'
  noteLabelsInList.innerHTML = (aPost && aPost.labels && aPost.labels.length > 0) ? aPost.labels.join(' ') : ' '

  noteDateInList = document.createElement('div')
  noteDateInList.className = 'leftBarLabels'
  noteDateInList.align = 'right'
  noteDateInList.id = 'click_gotoPost_' + postType + '_' + postId + '_date'
  noteDateInList.innerHTML = aPost._date_published ? ('Published on ' + freezr.utils.longDateFormat(aPost._date_published) + (aPost.editedPostPublish ? ' - modified post publishing' : '')) : (aPost.unpublished ? ('UNpublished on ' + freezr.utils.longDateFormat(aPost.unpublished)) : (aPost._date_modified ? ('Last changed: ' + freezr.utils.longDateFormat(aPost._date_modified)) : (aPost.created_locally ? (' new: ' + freezr.utils.longDateFormat(aPost.created_locally)) : '')))

  noteWrap.appendChild(noteTitleInList)
  noteWrap.appendChild(noteTextInList)
  noteWrap.appendChild(noteLabelsInList)
  noteWrap.appendChild(noteDateInList)

  return noteWrap
}

// clicks
var doClick = {
  doSearch: function () {
    populateLeftPanel()
  },
  menu: function () {
    window.clearInterval(stats.localSaveIntervaler)
    saveOrRemoveEmptyPost()
    savePost()
    stats.postIsInEditMode = false
    toggleLeftMenu(false)
  },
  newPost: function () {
    savePost()
    clearPostFields()
    toggleLeftMenu(true)
    newPost()
    showCurrentPost('edit')
    if (!stats.localSaveIntervaler) stats.localSaveIntervaler = setInterval(savePost, 2000)
    document.getElementById('titleDiv').focus()
  },
  menuBackGround: function () {
    if (currPostPointer) toggleLeftMenu(true)
  },
  delete: function () {
    deletePost()
  },
  dialogueBackGround: function () {
    closeDialogue()
  },
  gotoPost: function (parts) {
    const id = parts[3]
    currPostPointer = poster.get('posts', id)
    if (currPostPointer) {
      if (!stats.localSaveIntervaler) stats.localSaveIntervaler = setInterval(savePost, 2000)
      showCurrentPost()
      toggleLeftMenu(true)
    } else {
      showWarning('COULD NOT FIND POST')
    }
  },
  save: function () {
    savePost(true)
  },
  chgView: function () {
    if (document.getElementById('pubView').style.display === 'none') {
      savePost()
      showCurrentPost('pub')
    } else {
      showCurrentPost('edit')
    }
  },
  publish: function () {
    freezr.perms.isGranted('publish_posts', function (isGranted) {
      if (!currPostPointer._id) {
        showWarning('Cannot publish an unsynced post. try in a second or 2', 2000)
        doSyncPosts()
      } else if (isGranted) {
        savePost()
        document.getElementById('dialogue_imggallery').innerHTML = ''
        initPostToPublishStatus()
        openDialogue('publishStep1')
      } else {
        showWarning('Please grant permission for publishing by pressing the freez button on the top right and then pressing "grant" .', 5000)
      }
    })
  },
  unpublish: function () {
    freezr.perms.isGranted('publish_posts', function (isGranted) {
      const publishStat = getPublishStats(currPostPointer)
      if (!currPostPointer._id) {
        showWarning('Cannot unpublish an unsynced post.')
      } else if (!publishStat._date_published) {
        showWarning("The post is not published, so you can't unpublish it.")
      } else if (isGranted) {
        prepareToPublishOrUnpublish(false)
      } else {
        showWarning('Please grant permission for publishing by pressing the freez button on the top right and then pressing "grant" .', 5000)
      }
    })
  },
  uploadPict: function () {
    uploadPictToServer()
  }
}

// Syncing Callbacks
var doSyncPosts = function (callFwd) {
  // onsole.log('doSyncPosts')
  poster.save()
  if (!stats.syncInProgress) {
    document.getElementById('click_save_0').className = document.getElementById('click_save_0').className.replace('clickable', 'greyedButt')
    document.getElementById('click_save_1').className = document.getElementById('click_save_1').className.replace('clickable', 'greyedButt')
    stats.syncCounter = 1
    stats.syncInProgress = true

    poster.sync('posts', {
      gotNewItemsCallBack: syncGotNewPosts,
      warningCallBack: syncWarningCB,
      uploadedItemTransform: dontSyncEmptyItems,
      downloadedItemTransform: null,
      uploadedItemCallback: null,
      endCallBack: (callFwd || syncEndCB),
      doNotCallUploadItems: false,
      numItemsToFetchOnStart: NUM_NOTES_TO_DOWNLOAD
    })
  } else {
    if (callFwd) callFwd('Syncing already in progress')
    console.log('Syncing already in progress')
  }
}
var dontSyncEmptyItems = function (aPost) {
  if (isEmptyPost(aPost)) return null
  aPost = JSON.parse(JSON.stringify(aPost))
  return aPost
}
var syncGotNewPosts = function (newPosts, changedPosts) {
  if (leftMenuIsShowing()) populateLeftPanel()
  changedPosts.forEach(function (aPost) {
    if (!currPostPointer) {
      console.warn('internal err getting post ', newPosts, changedPosts)
    } else {
      if (currPostPointer._id === aPost._id) { showCurrentPost() }
    }
  })
}
var syncWarningCB = function (msgJson) {
  console.warn('WARNING message ' + msgJson.status)
  if (msgJson && msgJson.msg) {
    showWarning('warning ' + msgJson.msg, ((msgJson.error && msgJson.error === 'no connection') ? 1000 : 5000))
  } else {
    showWarning('inernal Error', 5000)
  }
  syncEndCB(msgJson)
}
var syncEndCB = function (aMsg) {
  if (aMsg && aMsg.error && aMsg.status === 401) {
    showWarning('Your login credentials have expired. Please login again.', 5000)
    window.open('/account/login/autoclose', null)
  }
  stats.syncInProgress = false
  document.getElementById('click_save_0').className = document.getElementById('click_save_0').className.replace('greyedButt', 'clickable')
  document.getElementById('click_save_1').className = document.getElementById('click_save_1').className.replace('greyedButt', 'clickable')
}
var handleConflictedPost = function (returnItem, resultIndex) {
  showWarning('There was a conflict syncing your post on ' + returnItem.title + '. The local copy was retained.')
  // onsole.log('item confliced',returnItem)
  toggleLeftMenu(false)
}
var showWarning = function (msg, timing) {
  if (stats.warningTimeOut) clearTimeout(stats.warningTimeOut)
  if (!msg) {
    console.log('showWarning nothing')
    document.getElementById('warnings').innerHTML = ''
    document.getElementById('warnings').style.display = 'none'
  } else {
    console.log('showWarning ' + msg)
    var newText = document.getElementById('warnings').innerHTML
    if (newText && newText !== ' ') newText += '<br/>'
    newText += msg
    document.getElementById('warnings').innerHTML = newText
    document.getElementById('warnings').style.display = 'block'
    if (timing) { stats.warningTimeOut = setTimeout(function () { showWarning() }, timing) }
  }
}

var openDialogue = function (doWhat, options) {
  document.getElementById('click_dialogueBackGround').style.display = 'block'
  document.getElementById('dialogue_inputText').innerText = ''
  document.getElementById('dialogue_Inner').style.top = null
  document.getElementById('dialogue_Inner').style.bottom = null
  resetDIalogueSizes()

  // Reset custom items:
  document.getElementById('dialogue_cancelButt').onclick = closeDialogue
  document.getElementById('dialogue_inputText').className = 'oneliner'
  document.getElementById('dialogue_okButt').onclick = null
  document.getElementById('click_uploadPict').style.display = 'none'
  document.getElementById('picture_file').onclick = function () {
    document.getElementById('click_uploadPict').style.display = 'inline-block'
    document.getElementById('dialogue_okays').style.display = 'none'
    document.getElementById('dialogue_instruct2').style.display = 'none'
    document.getElementById('dialogue_inputText').style.display = 'none'
  }
  document.getElementById('dialogue_inputText').setAttribute('data-placeholder', '')

  var showHideOptions
  if (doWhat === 'insertImage') {
    showHideOptions = {
      dialogue_okays: true,
      dialogue_okButt: 'Okay',
      dialogue_cancelButt: 'Cancel',
      dialogue_instruct1: 'Please choose a file to upload a picture...',
      dialogue_instruct2: (isMobile() ? 'Enter' : 'or just enter') + '/paste the url of an image.',
      dialogue_inputText: true,
      dialogue_uploader: true,
      dialogue_pictSize: true,
      dialogue_pictFloat: true
    }
    document.getElementById('dialogue_inputText').setAttribute('data-placeholder', 'Type or paste image URL here.')
    document.getElementById('dialogue_okButt').onclick = function () { nowInsertPictureUrl() }
    addListenersToRadio(null)
  } else if (doWhat === 'insertUrl') {

  } else if (doWhat === 'formatImage') {
    showHideOptions = {
      dialogue_okays: true,
      dialogue_okButt: 'Okay',
      dialogue_cancelButt: 'Cancel',
      dialogue_instruct1: 'Choose picture formatting objects:',
      dialogue_pictSize: true,
      dialogue_pictFloat: true
    }
    document.pictSizeRadioForm.pictSizeRadio.value = options.el.width || '75%'
    document.pictSizeRadioForm.pictSizeRadio.value = options.el.width || '75%'
    addListenersToRadio(options.el)

    document.getElementById('dialogue_okButt').onclick = function () {
      formatPictureForPost(options.el)
      closeDialogue()
    }
  } else if (doWhat === 'publishStep1') { // summary text
    showHideOptions = {
      dialogue_instruct1: 'Suggest a short summary of your blog. This is used in feeds and summary pages.',
      dialogue_inputText: postToPublishStatus.summaryText,
      dialogue_okays: true,
      dialogue_okButt: 'Next',
      dialogue_cancelButt: 'Cancel'
    }
    document.getElementById('dialogue_inputText').className = 'oneliner longBox'
    document.getElementById('dialogue_okButt').innerHTML = 'Next'
    document.getElementById('dialogue_okButt').onclick = function () {
      postToPublishStatus.summaryText = document.getElementById('dialogue_inputText').innerText
      openDialogue('publishStep2')
    }
  } else if (doWhat === 'publishStep2') { //
    if (postToPublishStatus.imgList.length === 0) {
      showHideOptions = {}
      setTimeout(function () { openDialogue('publishStep2a') }, 0)
    } else {
      console.log('to do - ADD A NO IMAGE OPTION')
      showHideOptions = {
        dialogue_instruct1: 'Choose an image to be shown in summaries of his post (in feeds).',
        dialogue_imggallery: true,
        dialogue_instruct2: '... and also choose a name for the image:',
        dialogue_inputText: (postToPublishStatus.mainimgtxt),
        dialogue_okays: true,
        dialogue_okButt: 'Next',
        dialogue_cancelButt: 'Back'
      }

      if (!postToPublishStatus.mainimgtxt) setTimeout(function () { document.getElementById('dialogue_instruct2').style.display = 'none' }, 0)
      const outer = document.getElementById('dialogue_imggallery')
      outer.innerHTML = ''
      postToPublishStatus.imgList.forEach((imgDiv) => {
        const imgEl = document.createElement('IMG')
        imgEl.src = imgDiv.src
        imgEl.onclick = chooseImgForSummary
        imgEl.className = 'imageChooser' + (imgDiv.src === postToPublishStatus.mainimgurl ? ' chosenImg' : '')
        outer.appendChild(imgEl)
      })

      // nownow add pictures and abitiy to choose - picts go to
      document.getElementById('dialogue_okButt').onclick = function () {
        postToPublishStatus.mainimgtxt = document.getElementById('dialogue_inputText').innerText
        openDialogue('publishStep2a')
      }
      document.getElementById('dialogue_cancelButt').onclick = function () { openDialogue('publishStep1') }
    }
  } else if (doWhat === 'publishStep2a') {
    showHideOptions = {
      dialogue_instruct1: 'Would you like the post to contain a twitter card?',
      dialogue_inputText: postToPublishStatus.twitterCard || (postToPublishStatus.mainimgurl ? 'summary_large_image' : 'summary'),
      dialogue_okays: true,
      dialogue_okButt: 'Next',
      dialogue_cancelButt: 'Back'
    }
    document.getElementById('dialogue_okButt').onclick = function () {
      if (['summary', 'summary_large_image'].indexOf(document.getElementById('dialogue_inputText').innerText) < 0) {
        document.getElementById('dialogue_inputText').innerText = postToPublishStatus.twitterCard || (postToPublishStatus.mainimgurl ? 'summary_large_image' : 'summary')
        document.getElementById('dialogue_instruct1').innerHTML = "Please enter 'summary' or 'summary_large_image'"
      } else {
        postToPublishStatus.twitterCard = document.getElementById('dialogue_inputText').innerText
        openDialogue('publishStep3')
      }
    }
    document.getElementById('dialogue_cancelButt').onclick = function () { openDialogue(postToPublishStatus.imgList.length < 3 ? 'publishStep1' : 'publishStep2') }
  } else if (doWhat === 'publishStep3') {
    const publishStat = getPublishStats(currPostPointer)
    showHideOptions = {
      dialogue_instruct1: 'What would you like the stated publish date / time to be?',
      dialogue_inputText: publishStat._date_published ? new Date(publishStat._date_published).toString() : new Date().toString(),
      dialogue_okays: true,
      dialogue_okButt: publishStat.public_id ? 'Re-publish' : 'Next',
      dialogue_cancelButt: 'Back'
    }

    document.getElementById('dialogue_okButt').onclick = function () {
      try {
        postToPublishStatus.pubDate = new Date(document.getElementById('dialogue_inputText').innerText).getTime()
      } catch (e) {
        // do nothing
      }
      if (isNaN(postToPublishStatus.pubDate)) {
        document.getElementById('dialogue_inputText').innerText = postToPublishStatus.pubDate ? new Date(postToPublishStatus.pubDate).toString() : new Date().toString()
        document.getElementById('dialogue_instruct1').innerHTML = 'Please enter a well formatted date.'
      } else {
        openDialogue('publishStep4')
      }
    }
    document.getElementById('dialogue_cancelButt').onclick = function () { openDialogue('publishStep2a') }
  } else if (doWhat === 'publishStep4') {
    const publishStat = getPublishStats(currPostPointer)
    if (publishStat.public_id) {
      showHideOptions = {
        dialogue_instruct1: stats.syncInProgress ? 'Try pressing publish again' : 'Going to republish post....',
        dialogue_okays: true,
        dialogue_okButt: 'Publish',
        dialogue_cancelButt: 'Back'
      }
      if (!stats.syncInProgress) { prepareToPublishOrUnpublish(true) } else { showWarning('System is syncing. Try again in a second.') }
    } else {
      const publishStat = getPublishStats(postToPublishStatus)
      showHideOptions = {
        dialogue_instruct1: 'Suggested Unique ID for this post.',
        dialogue_inputText: publishStat.public_id || getSuggestedId(),
        dialogue_checkUniqueness: true,
        dialogue_okays: true,
        dialogue_okButt: 'PUBLISH NOW',
        dialogue_cancelButt: 'Back'
      }
    }
    document.getElementById('dialogue_okButt').onclick = function () {
      prepareToPublishOrUnpublish(true, document.getElementById('dialogue_inputText').innerText.trim())
    }
    document.getElementById('dialogue_cancelButt').onclick = function () { openDialogue('publishStep3') }
    document.getElementById('dialogue_checkUniqueButt').onclick = function () {
      freezr.feps.publicquery({ pid: document.getElementById('dialogue_inputText').innerText.trim() }, function (error, ret) {
        ret = freezr.utils.parse(ret)
        document.getElementById('dialogue_instruct2').style.display = 'block'
        if (error || ret.error || ret.errors.length > 0) document.getElementById('dialogue_instruct2').innerText = 'There were some errors getting the availability'
        if (!ret.error && ret.results.length > 0) document.getElementById('dialogue_instruct2').innerText = 'This id is already in use. Please try another.'
        if (!ret.error && ret.results.length === 0) document.getElementById('dialogue_instruct2').innerText = 'The id is available. Feel free to publish!!'
      })
    }
  }
  const dialogueElements = ['dialogue_okays', 'dialogue_okButt', 'dialogue_cancelButt', 'dialogue_checkUniqueness', 'dialogue_instruct1', 'dialogue_instruct2', 'dialogue_inputText', 'dialogue_uploader', 'dialogue_pictSize', 'dialogue_pictFloat', 'dialogue_imggallery']
  const inlines = ['dialogue_okButt', 'dialogue_cancelButt']
  dialogueElements.forEach((anId) => {
    document.getElementById(anId).style.display = showHideOptions[anId] ? (inlines.indexOf(anId) > -1 ? 'inline-block' : 'block') : 'none'
    if (typeof showHideOptions[anId] === 'string') document.getElementById(anId).innerText = showHideOptions[anId]
  })
}
var closeDialogue = function () {
  document.getElementById('click_dialogueBackGround').style.display = 'none'
  savePost()
}
var chooseImgForSummary = function (e) {
  const oldChosen = document.getElementsByClassName('chosenImg')[0]
  if (oldChosen) oldChosen.className = 'imageChooser'
  postToPublishStatus.mainimgurl = e.target.src
  e.target.className = 'imageChooser chosenImg'
  document.getElementById('dialogue_instruct2').style.display = 'block'
  document.getElementById('dialogue_inputText').style.display = 'block'
  document.getElementById('dialogue_inputText').innerHTML = getFileNameFromUrl(e.target.src)
}

// Picture insertion
var lastNode, lastNodeLength // lastChar, allChars,
// Based on stackoverflow.com/questions/1563427/how-do-i-find-out-the-dom-node-at-cursor-in-a-browsers-editable-content-window and earlier from stackoverflow.com/questions/4767848/get-caret-cursor-position-in-contenteditable-area-containing-html-content
var addListenersToRadio = function (imgEl) {
  var radios
  ['Size', 'Float'].forEach((radioType) => {
    radios = document.forms['pict' + radioType + 'RadioForm'].elements['pict' + radioType + 'Radio']
    for (const radio in radios) {
      radios[radio].onclick = imgEl ? function () { formatPictureForPost(imgEl) } : null
    }
  })
}
var uploadPictToServer = function () {
  var fileInput = document.getElementById('picture_file')
  var file = (fileInput && fileInput.files) ? fileInput.files[0] : null
  if (!fileInput || !file) {
    showWarning('Please upload a file first.')
  } else {
    freezr.feps.upload(file, null, function (error, returndata) {
      // returndata = freezr.utils.parse(returndata)
      if (error || returndata.error || !returndata || !returndata._id) {
        showWarning(error || returndata.error)
      } else {
        freezr.utils.getFileToken(returndata._id, {
          requestee_app: freezrMeta.appName,
          permission_name: 'self'
        }, function (fileToken) {
          const url = '/feps/userfiles/' + freezrMeta.appName + '/' + freezrMeta.userId + '/' + returndata._id + '?fileToken=' + fileToken
          document.getElementById('dialogue_inputText').innerText = url
          currPostPointer.picts = currPostPointer.picts || []
          currPostPointer.picts.push(url)
          nowInsertPictureUrl(url)
        })
        poster.save()
      }
    })
  }
}
var nowInsertPictureUrl = function (url) {
  document.getElementById('click_dialogueBackGround').style.display = 'none'
  editor.content.focus()
  var range = document.createRange()
  var sel = window.getSelection()
  // let gotSelErr = false
  try {
    range.setStart(lastNode, lastNodeLength)
  } catch (e) {
    console.warn('error inserting picture 1 - moved position')
    try {
      range.setStart(lastNode, 0)
    } catch (e) {
      console.warn('gor err ' + e)
      // gotSelErr = true
    }
  }
  try {
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  } catch (e) {
    console.warn('could not get range')
  }
  editor.content.focus()

  if (!url || typeof url !== 'string') url = document.getElementById('dialogue_inputText').innerText.trim()
  if (url) {
    pell.exec('insertImage', url)
    let imgEl = ''
    const imgList = document.getElementsByTagName('IMG')
    Array.prototype.forEach.call(imgList, function (anImg) {
      if (anImg.src === encodeURI(window.location.protocol + '//' + window.location.hostname + (window.location.port ? (':' + window.location.port) : '') + url)) imgEl = anImg
    })
    formatPictureForPost(imgEl)
  }
}
var formatPictureForPost = function (imgEl) {
  if (imgEl) {
    imgEl.style.width = document.querySelector('input[name="pictSizeRadio"]:checked').value
    const floatProp = document.querySelector('input[name="pictFloatRadio"]:checked').value
    if (floatProp === 'none') {
      imgEl.style.float = null
      if (imgEl.parentNode.tagName !== 'CENTER') {
        const cent = document.createElement('center')
        imgEl.parentNode.insertBefore(cent, imgEl)
        cent.appendChild(imgEl)
      }
    // if parentEl.tag !='center'
    // insertbefore img a Center - then put image
    } else {
      if (imgEl.parentNode.tagName === 'CENTER') {
        const cent = imgEl.parentNode
        cent.parentNode.insertBefore(imgEl, cent)
        cent.parentNode.removeChild(cent)
      }
      imgEl.style.float = floatProp
    }
  } else {
    showWarning('Error finding image to format.', 2000)
  }
}
var captureEditorRangeData = function () {
  editor.content.onkeyup = getCharacterOffsetWithin
  editor.content.onclick = getCharacterOffsetWithin
}
function getCharacterOffsetWithin () {
  const sel = window.getSelection()
  if (sel.rangeCount > 0 && sel.getRangeAt(0)) {
    const range = sel.getRangeAt(0)
    const container = range.commonAncestorContainer
    lastNode = container.nodeType === 3 ? container.parentNode : container
    lastNodeLength = range.endOffset
  } else {
    showWarning('older versions of webkit and ie not supported. sorry')
  }
}

// Mobile / Desktop / resizing
var isMobile = function () {
  //
  return (/iPhone|iPod|Android/.test(navigator.userAgent) && !window.MSStream)
}
window.onresize = function (event) {
  resetSizes()
}
var resetSizes = function (event) {
  resetTestBoxSize()
  redoMenus()
  resetDIalogueSizes()
  if (window.innerWidth < 500) document.getElementById('listingTopButts').style.paddingRight = '60px'
}
var resetTestBoxSize = function () {
  if (!isMobile()) {
    editor.content.style.height = (window.innerHeight - 180 - document.getElementById('titleDiv').offsetHeight) + 'px'
  }
}
var resetDIalogueSizes = function () {
  if (document.getElementById('click_dialogueBackGround').style.display === 'block') {
    const inner = document.getElementById('dialogue_Inner')
    inner.style.top = (isMobile() ? 20 : 60) + 'px'
    inner.style.left = Math.max((window.innerWidth * 0.05), (window.innerWidth / 2 - 250)) + 'px'
    inner.style.right = inner.style.left
    if (parseInt(inner.style.top) + inner.offsetHeight > window.innerHeight) {
      inner.style.top = '10px'
      inner.style.bottom = '10px'
    }
  }
}

// Generic utilities
function removeSpaces (aText) {
  aText = aText.replace(/&nbsp;/g, ' ').trim()
  while (aText.indexOf('  ') > -1) {
    aText = aText.replace(/  /, ' ')
  }
  return aText
}
var pasteAsText = function (evt) {
  // for more details and improvements: stackoverflow.com/questions/12027137/javascript-trick-for-paste-as-plain-text-in-execcommand
  evt.preventDefault()
  var text = evt.clipboardData.getData('text/plain')
  document.execCommand('insertHTML', false, text)
}
function sortByModDate (obj1, obj2) {
  //
  return getMaxLastModDate(obj2) - getMaxLastModDate(obj1)
}
function getMaxLastModDate (obj) {
  // onsole.log('getMaxLastModDate obj is '+JSON.stringify(obj))
  if (!obj) {
    return 0
  } else if (obj._date_modified) {
    return obj._date_modified
  } else if (obj.fj_modified_locally) {
    return obj.fj_modified_locally
  } else if (obj.created_locally) {
    return obj.created_locally
  } else {
    return 0 // error
  }
}
function startsWith (longertext, checktext) {
  if (!longertext || !checktext || !(typeof longertext === 'string') || !(typeof checktext === 'string')) {
    return false
  } else if (checktext.length > longertext.length) {
    return false
  } else {
    return (checktext === longertext.slice(0, checktext.length))
  }
}
function endsWith (longertext, checktext) {
  if (!longertext || !checktext || !(typeof longertext === 'string') || !(typeof checktext === 'string')) {
    return false
  } else if (checktext.length > longertext.length) {
    return false
  } else {
    return (checktext === longertext.slice(longertext.length - checktext.length))
  }
}
function getFileNameFromUrl (aUrl) {
  if (!aUrl || aUrl.indexOf('/') < 0) return ''
  return aUrl.slice((aUrl.lastIndexOf('/') + 1))
}
function getFileIdFromImgDiv (aDiv) {
  if (!aDiv || !aDiv.src || aDiv.src.indexOf('/') < 0 || !isPosterLink(aDiv.src)) {
    console.warn('Internal err - expected pictdiv and got ', aDiv)
    return null
  } else {
    const nameEnds = (aDiv.src.indexOf(freezrMeta.appName) + freezrMeta.appName.length + freezrMeta.userId.length + 2)
    return decodeURI(aDiv.src.slice(nameEnds).split('?')[0])
  }
}
function addToListAsUnique (aList,anItem) {
  if (!anItem) {
    return aList
  } else if (!aList) {
    return [anItem]
  } else if (aList.indexOf(anItem) < 0) {
    aList.push(anItem)
  }
  return aList
}
