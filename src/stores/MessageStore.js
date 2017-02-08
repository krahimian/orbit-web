'use strict'

import sortBy from 'lodash.sortby'
import take from 'lodash.take'
import differenceWith from 'lodash.differencewith'
import Reflux from 'reflux'
import AppActions from 'actions/AppActions'
import UIActions from 'actions/UIActions'
import NetworkActions from 'actions/NetworkActions'
import ChannelActions from 'actions/ChannelActions'
import NotificationActions from 'actions/NotificationActions'
import UserActions from 'actions/UserActions'
import UserStore from 'stores/UserStore'
import Logger from 'logplease'

const logger = Logger.create('MessageStore', { color: Logger.Colors.Magenta })

window.LOG = 'none'

const messagesBatchSize = 16

const MessageStore = Reflux.createStore({
  listenables: [AppActions, UIActions, NetworkActions, ChannelActions],
  init: function() {
    this.currentChannel = null
    this.channels = {}
    this.orbit = null
    this._reset()

    this.loadingHistory = true

    // Setup send queue
    this.q = []
    this.sending = false
    setInterval(() => {
      this._processQ()
    }, 16)

    // debug for Friedel
    window.send = (amount, interval) => {
      let i = 0
      let timer = setInterval(() => {
        this.onSendMessage(this.currentChannel, "hello " + i)
        i ++
        if(i === amount) clearInterval(timer)
      }, interval)
    }
  },
  _reset: function() {
    this.channels = {}
    this.currentChannel = null
    this.orbit = null
    this.loadingHistory = true
    this.q = []
    this.sending = false
  },
  _add(channel, messages, isNewMessage = false) {
    messages = messages || []
    let uniqueNew = differenceWith(messages, this.channels[channel].messages, (a, b) => a.hash === b.hash && a.meta.ts === b.meta.ts)

    if (uniqueNew.length > 0) {
      // Process all new messages
      if (isNewMessage) {
        uniqueNew.forEach((post) => {
          // Add users to the known users list
          UserActions.addUser(post.meta.from)
          // Fire notifications
          NotificationActions.newMessage(channel, post)
        })
      }

      this.channels[channel].messages = this.channels[channel].messages.concat(uniqueNew)
      this.channels[channel].messages = sortBy(this.channels[channel].messages, (e) => e.meta.ts)
      // console.log("Messages in UI:", this.channels[channel].messages.length)

      setImmediate(() => {
        this.trigger(channel, this.channels[channel].messages)
      })
    }
  },
  onInitialize: function(orbit) {
    this.orbit = orbit
    this.syncCount = 0

    this.orbit.events.on('message', (channel, message) => {
      // logger.info("-->", channel, message)
      const len = this.channels[channel].messages.length
      this.orbit.get(channel, null, null, len + 1)
        .then((messages) => {
          setImmediate(() => {
            this._add(channel, messages, true)
          })
        })
        .catch((e) => console.error(e))
    })

    this.orbit.events.on('synced', (channel) => {
      this.syncCount --
      const len = this.channels[channel].messages.length
      this.orbit.get(channel, null, null, len + messagesBatchSize)
        .then((messages) => {
          setImmediate(() => {
            this._add(channel, messages, true)
            if (this.syncCount <= 0)
              UIActions.stopLoading(channel, "load")
          })
        })
        .catch((e) => console.error(e))
    })

    this.orbit.events.on('joined', (channel) => {
      logger.info(`Joined #${channel}`)
      const feed = this.orbit.channels[channel].feed

      feed.events.on('sync', (name, messages) => {
        this.syncCount ++
        UIActions.startLoading(channel, "load")
      })

      feed.events.on('ready', () => {
        this.syncCount --
        this.orbit.get(channel, null, null, messagesBatchSize)
          .then((messages) => {
            setImmediate(() => {
              this._add(channel, messages)
              if (this.syncCount <= 0)
                UIActions.stopLoading(channel, "load")
            })
          })
          .catch((e) => console.error(e))
      })
    })
  },
  onDisconnect: function() {
    this._reset()
  },
  onJoinChannel: function(channel, password) {
    if(!this.channels[channel])
      this.channels[channel] = { messages: [] }
    this.currentChannel = channel
  },
  onLeaveChannel: function(channel: string) {
    delete this.channels[channel]
  },
  onLoadMessages: function(channel: string) {
    if (this.channels[channel]) {
      this.trigger(channel, this.channels[channel].messages)
    }
  },
  onLoadMoreMessages: function(channel: string, force: boolean) {
    if(channel !== this.currentChannel)
      return

    this.loadMessages(channel, null, null, messagesBatchSize, force)
  },
  loadMessages: function(channel: string, olderThanHash: string, newerThanHash: string, amount: number, force: boolean) {
    if (this.channels[channel].messages.length > 0) {
      const len = this.channels[channel].messages.length
      this.orbit.get(channel, null, null, len + messagesBatchSize)
        .then((messages) => {
          setImmediate(() => {
            this._add(channel, messages)
            if ((messages.length > 0 && !this.loadingHistory && messages.length > len) || force) {
              this.loadingHistory = true
              this.orbit.loadMoreHistory(channel, messagesBatchSize)
                .then(() => this.loadingHistory = false)
            }
          })
        })
    }
  },
  _processQ: function() {
    if (this.q && this.q.length > 0 && !this.sending) {
      this.sending = true
      const task = this.q.shift()
      this.orbit.send(task.channel, task.text)
        .then((post) => {
          this.sending = false
          if (task.callback) task.callback()
        })
    }
  },
  onSendMessage: function(channel: string, text: string, replyToHash: string, cb) {
    // logger.debug("--> Send message: ", text, replyToHash)
    if(!this.r) this.r = 0
    this.r++
    if(!this.q) this.q = []
    this.q.push({ channel: channel, text: text, callback: cb})
  },
  onAddFile: function(channel: string, filePath: string, buffer, meta) {
    logger.debug("--> Add file: " + filePath + buffer !== null)
    UIActions.startLoading(channel, "file")
    this.orbit.addFile(channel, filePath, buffer, meta)
      .then((post) => UIActions.stopLoading(channel, "file"))
      .catch((e) => {
        const error = e.toString()
        logger.error(`Couldn't add file: ${JSON.stringify(filePath)} -  ${error}`)
        UIActions.raiseError(error)
      })
  },
  onLoadFile: function(hash: string, asURL: boolean, asStream: boolean, callback) {
    const isElectron = window.isElectron
    if(isElectron && asURL) {
      // console.log(window.gatewayAddress, this.orbit._ipfs.GatewayAddress)
      callback(null, null, 'http://' + window.gatewayAddress + hash)
    } else if(isElectron) {
      var xhr = new XMLHttpRequest()
      xhr.open('GET', 'http://' + window.gatewayAddress + hash, true)
      xhr.responseType = 'blob'
      xhr.onload = function(e) {
        if(this.status == 200) {
          callback(null, this.response) // this.response is a Blob
        }
      }
      xhr.send()
    } else {
      this.orbit.getFile(hash)
        .then((stream) => {
          if(asStream) {
            callback(null, null, null, stream)
          } else {
            let buf = new Uint8Array(0)
            stream.on('error', () => callback(err, null))
            stream.on('data', (chunk) => {
              const tmp = new Uint8Array(buf.length + chunk.length)
              tmp.set(buf)
              tmp.set(chunk, buf.length)
              buf = tmp
            })
            stream.on('end', () => {
              callback(null, buf)
            })
          }
        })
        .catch((e) => logger.error(e))
    }
  },
  onLoadDirectoryInfo: function(hash, callback) {
    // TODO: refactor
    this.orbit.getDirectory(hash)
      .then((result) => {
        result = result.map((e) => {
          return {
            hash: e.Hash,
            size: e.Size,
            type: e.Type === 1 ? "directory" : "file",
            name: e.Name
          }
        })
        callback(null, result)
      })
  }
})

export default MessageStore
