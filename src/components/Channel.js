'use strict'

import React from 'react'
import last from 'lodash.last'
import Message from 'components/Message'
import Message2 from 'components/Message2'
import ChannelControls from 'components/ChannelControls'
import NewMessageNotification from 'components/NewMessageNotification'
import Dropzone from 'react-dropzone'
import MessageStore from 'stores/MessageStore'
import ChannelStore from 'stores/ChannelStore'
import UIActions from 'actions/UIActions'
import ChannelActions from 'actions/ChannelActions'
import Profile from "components/Profile"
import 'styles/Channel.scss'
import Logger from 'logplease'
const logger = Logger.create('Channel', { color: Logger.Colors.Cyan })

window.LOG = 'none'

class Channel extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      peers: [],
      channelChanged: true,
      channelName: null,
      messages: [],
      loading: false,
      loadingText: 'Connecting...',
      reachedChannelStart: false,
      channelMode: "Public",
      error: null,
      replyto: null,
      dragEnter: false,
      username: props.user ? props.user.name : '',
      unreadMessages: 0,
      appSettings: props.appSettings,
      theme: props.theme,
      showUserProfile: null,
      userProfilePosition: null
    }

    this.peersPollTimer = null
    this.scrollTimer = null
    this.topMargin = 240
    this.bottomMargin = 20

    this.onShowProfile = this.onShowProfile.bind(this)
    this.onDragEnter = this.onDragEnter.bind(this)
    this.onScrollToPreview = this.onScrollToPreview.bind(this)
  }

  shouldComponentUpdate(nextProps, nextState) {
    return this.state.messages.length !== nextState.messages.length
      || this.state.unreadMessages != nextState.unreadMessages
      || this.state.channelName != nextState.channelName
      || this.state.dragEnter != nextState.dragEnter
      || this.state.loading != nextState.loading
      || this.state.peers.length != nextState.peers.length
      || this.state.showUserProfile != nextState.showUserProfile
  }

  componentWillReceiveProps(nextProps) {
    // logger.debug("PROPS CHANGED", nextProps, this.state.channelName)
    if(nextProps.channel !== this.state.channelName) {
      this.setState({
        channelChanged: true,
        unreadMessages: 0,
        loading: false,
        reachedChannelStart: false,
        messages: []
      })
      UIActions.focusOnSendMessage()
      ChannelActions.loadMessages(nextProps.channel)
      if (this.peersPollTimer) clearInterval(this.peersPollTimer)
    }

    this.setState({
      channelName: nextProps.channel,
      username: nextProps.user ? nextProps.user.name : '',
      appSettings: nextProps.appSettings,
      theme: nextProps.theme
    })
  }

  componentDidMount() {
    this.unsubscribeFromChannelStore = ChannelStore.listen(this.onPeers.bind(this))
    this.unsubscribeFromMessageStore = MessageStore.listen(this.onNewMessages.bind(this))
    this.unsubscribeFromErrors = UIActions.raiseError.listen(this._onError.bind(this))
    this.stopListeningChannelState = ChannelActions.reachedChannelStart.listen(this._onReachedChannelStart.bind(this))
    this.node = this.refs.MessagesView
    this.unsubscribeFromLoadingStart = UIActions.startLoading.listen((channel) => {
      if (channel === this.state.channelName && !this.state.loading) {
        this.setState({ loading: true })
      }
    })
    this.unsubscribeFromLoadingStop = UIActions.stopLoading.listen((channel) => {
      if (channel === this.state.channelName && this.state.loading)
        this.setState({ loading: false })
    })
  }

  _onError(errorMessage) {
    console.error("Channel:", errorMessage)
    this.setState({ error: errorMessage })
  }

  _onReachedChannelStart() {
  }

  componentWillUnmount() {
    clearTimeout(this.timer)
    clearTimeout(this.scrollTimer)
    this.unsubscribeFromChannelStore()
    this.unsubscribeFromMessageStore()
    this.unsubscribeFromErrors()
    this.stopListeningChannelState()
    this.unsubscribeFromLoadingStart()
    this.unsubscribeFromLoadingStop()
    this.setState({ messages: [] })
  }

  onPeers(channels, peers) {
    const p = peers[this.state.channelName]
    if (p !== undefined && p.length !== this.state.peers.length)
      this.setState({ peers: p || [] })
  }

  onNewMessages(channel: string, messages) {
    if(channel !== this.state.channelName)
      return

    // THIS IS ADDING A LOT OF CYCLES TO EACH FRAME!!

    // this.node = this.refs.MessagesView
    // if(this.node && this.node.scrollHeight - this.node.scrollTop + this.bottomMargin > this.node.clientHeight
    //   && this.node.scrollHeight > this.node.clientHeight + 1
    //   && this.state.messages.length > 0 && last(messages).meta.ts > last(this.state.messages).meta.ts
    //   && this.node.scrollHeight > 0) {
    //   this.setState({
    //     unreadMessages: this.state.unreadMessages + 1
    //   })
    // }

    const prevLength = this.state.messages.length
    setImmediate(() => {
      this.setState({ messages: messages }, () => {
        if (messages.length > prevLength) {
          // Load more history to the "buffer"
          if(this.loadMoreTimeout) clearTimeout(this.loadMoreTimeout)
          this.loadMoreTimeout = setTimeout(() => {
            if(this._shouldLoadMoreMessages())
              this.loadOlderMessages()
          }, 30)
        }
      })
    })
  }

  sendMessage(text: string, replyto: string, cb) {
    if(text !== '') {
      ChannelActions.sendMessage(this.state.channelName, text, replyto, cb)
      // this.setState({ replyto: null })
    }
  }

  sendFile(source) {
    if(source.directory || (source.filename !== '' && source.buffer !== null))
      ChannelActions.addFile(this.state.channelName, source)
  }

  loadOlderMessages(force) {
    // if(!this.state.loading) {
      ChannelActions.loadMoreMessages(this.state.channelName, force)
    // }
  }

  componentWillUpdate() {
    this.node = this.refs.MessagesView
    this.scrollTop = this.node.scrollTop
    this.scrollHeight = this.node.scrollHeight
  }

  componentDidUpdate() {
    const scrollHeight = this.node.scrollHeight
    const clientHeight = this.node.clientHeight

    this.node = this.refs.MessagesView
    this.scrollAmount = scrollHeight - this.scrollHeight
    this.keepScrollPosition = (this.scrollAmount > 0 && this.scrollTop > (0 + this.topMargin)) || this.state.reachedChannelStart
    this.shouldScrollToBottom = (this.node.scrollTop + clientHeight + this.bottomMargin) >= this.scrollHeight

    if(!this.keepScrollPosition)
      this.node.scrollTop += this.scrollAmount

    if(this.shouldScrollToBottom)
      this.node.scrollTop = scrollHeight + clientHeight

    // If the channel was changed, scroll to bottom to avoid weird positioning
    // TODO: replace with remembering each channel's scroll position on channel change
    if(this.state.channelChanged) {
      this.onScrollToBottom()
      this.setState({ channelChanged: false })
    }

    // Wait for the render (paint) cycle to finish before checking.
    // The DOM element sizes (ie. scrollHeight and clientHeight) are not updated until the paint cycle finishes.
    // if(this.loadMoreTimeout) clearTimeout(this.loadMoreTimeout)
    // this.loadMoreTimeout = setTimeout(() => {
    //   if(this._shouldLoadMoreMessages())
    //     this.loadOlderMessages()
    // }, 30)
  }

  _shouldLoadMoreMessages() {
    return this.node && (this.node.scrollTop - this.topMargin <= 0 || this.node.scrollHeight === this.node.clientHeight)
  }

  onDrop(files) {
    this.setState({ dragEnter: false })
    files.forEach((file) => {
      const meta = { mimeType: file.type, size: file.size }
      // Electron can return a path of a directory
      if(file.path) {
        console.log("FILE", file)
        this.sendFile({ filename: file.path, directory: file.path, meta: meta })
      } else {
        // In browsers, read the files returned by the event
        // TODO: add buffering support
        const reader = new FileReader()
        reader.onload = (event) => {
          console.log("FILE", file)
          this.sendFile({ filename: file.name, buffer: event.target.result, meta: meta })
        }
        reader.readAsArrayBuffer(file)
        // console.error("File upload not yet implemented in browser. Try the electron app.")
      }
    })
    UIActions.focusOnSendMessage()
  }

  onDragEnter() {
    this.setState({ dragEnter: true })
  }

  onDragLeave() {
    this.setState({ dragEnter: false })
  }

  onScroll() {
    if(this.scrollTimer)
      clearTimeout(this.scrollTimer)

    // After scroll has finished, check if we should load more messages
    // Using timeout here because of OS-applied scroll inertia
    const loadDelay = 100
    this.scrollTimer = setTimeout(() => {
      if(this._shouldLoadMoreMessages())
        this.loadOlderMessages(true)
    // this.setState({ loadingText: 'Loading more messages...' })
    }, loadDelay)

    // If we scrolled to the bottom, hide the "new messages" label
    const hideDelay = 100
    setTimeout(() => {
      this.node = this.refs.MessagesView
      if(this.node.scrollHeight - this.node.scrollTop - 10 <= this.node.clientHeight) {
        this.setState({ unreadMessages: 0 })
      }
    }, hideDelay)
  }

  onScrollToBottom() {
    UIActions.focusOnSendMessage()
    this.node.scrollTop = this.node.scrollHeight + this.node.clientHeight
  }

  onScrollToPreview(node) {
    const previewHeight = node.clientHeight
    const previewRect = node.getBoundingClientRect()
    const channelRect = this.node.getBoundingClientRect()
    const amount = previewRect.bottom - channelRect.bottom
    // console.log(amount, previewHeight)
    // Scroll down so that we see the full preview element
    if (amount > 0) this.node.scrollTop += amount + 5
  }

  onShowProfile(user, evt) {
    evt.persist()
    evt.stopPropagation()
    // console.log("PROFILE", user, evt)
    if(!this.state.showUserProfile || (this.state.showUserProfile && user.id !== this.state.showUserProfile.id)) {

      var body = document.body, html = document.documentElement
      var height = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight)

      // if(evt.pageY > height / 2)
      //   console.log("clicked on the bottom half")
      // else
      //   console.log("clicked on the top half")

      const profilePopupHeight = 440
      let padBottom = false
      if(evt.pageY + profilePopupHeight > height) {
        // console.log("can't fit it on the screen")
        padBottom = true
      }

      const x = 0
      const y = 0

      this.setState({
        showUserProfile: user,
        userProfilePosition: {
          x: evt.target.clientWidth + evt.target.offsetLeft,
          y: padBottom ? (height - profilePopupHeight) : evt.pageY
        }
      })
    } else {
      this.setState({ showUserProfile: null, userProfilePosition: null })
    }
  }

 onReplyTo(message) {
    this.setState({ replyto: message })
    UIActions.focusOnSendMessage()
  }

  renderMessages() {
    const { messages, username, channelName, appSettings } = this.state
    const { colorifyUsernames, useEmojis, useMonospaceFont, font, monospaceFont } = appSettings

    // const style = {
    //   fontFamily: useMonospaceFont ? monospaceFont : font,
    //   fontSize: useMonospaceFont ? '0.9em' : '1.0em',
    //   fontWeight: useMonospaceFont ? 'normal' : 'bold'
    // }

    const elements = messages.map((message) => {
      if (appSettings.useLargeMessage) {
        return <Message2
          message={message}
          key={message.hash + message.meta.ts}
          onReplyTo={this.onReplyTo.bind(this)}
          onShowProfile={this.onShowProfile.bind(this)}
          onDragEnter={this.onDragEnter.bind(this)}
          onScrollToPreview={this.onScrollToPreview.bind(this)}
          highlightWords={[username]}
          colorifyUsername={colorifyUsernames}
          useEmojis={useEmojis}
          style={style}
        />
      } else {
        return <Message
          message={message}
          key={message.hash + message.meta.ts}
          onShowProfile={this.onShowProfile}
          onDragEnter={this.onDragEnter}
          onScrollToPreview={this.onScrollToPreview}
          highlightWords={[username]}
          colorifyUsername={colorifyUsernames}
          useEmojis={useEmojis}
        />
      }
    })
        // {reachedChannelStart && !loading ? `Joined #${channelName}` : loadingText }
    elements.unshift(
      <div className="firstMessage" key="firstMessage" onClick={this.loadOlderMessages.bind(this)}>
        {`Joined #${channelName}`}
      </div>
    )
    return elements
  }

  renderFileDrop() {
    const { theme, dragEnter, channelName } = this.state
    if (dragEnter) {
      return (
        <Dropzone
          className="dropzone"
          activeClassName="dropzoneActive"
          disableClick={true}
          onDrop={this.onDrop.bind(this)}
          onDragEnter={this.onDragEnter.bind(this)}
          onDragLeave={this.onDragLeave.bind(this)}
          style={theme} >
            <div ref="dropLabel" style={theme}>Add files to #{channelName}</div>
        </Dropzone>
      )
    }
    return null
  }

  render() {
    const { showUserProfile, userProfilePosition, unreadMessages, loading, channelMode, appSettings, replyto, theme } = this.state

    const profile = showUserProfile ?
      <Profile
        user={showUserProfile}
        x={userProfilePosition.x}
        y={userProfilePosition.y}
        theme={theme}
        onClose={this.onShowProfile.bind(this)}/>
      : null

    return (
      <div className="Channel flipped" onDragEnter={this.onDragEnter.bind(this)}>
        <div>{profile}</div>
        <div className="Messages" ref="MessagesView" onScroll={this.onScroll.bind(this)}>
          {this.renderMessages()}
        </div>
        <NewMessageNotification
          onClick={this.onScrollToBottom.bind(this)}
          unreadMessages={unreadMessages} />
        <ChannelControls
          onSendMessage={this.sendMessage.bind(this)}
          onSendFiles={this.onDrop.bind(this)}
          isLoading={loading}
          channelMode={this.state.peers.length + " peers"}
          appSettings={appSettings}
          theme={theme}
          replyto={replyto}
        />
        {this.renderFileDrop()}
      </div>
    )
  }

}

export default Channel
