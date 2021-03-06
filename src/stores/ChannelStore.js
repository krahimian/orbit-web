'use strict'

import Reflux from 'reflux'
import AppActions from 'actions/AppActions'
import NetworkActions from 'actions/NetworkActions'
import ChannelActions from 'actions/ChannelActions'
import AppStateStore from 'stores/AppStateStore'
import Logger from 'logplease'

const logger = Logger.create('ChannelStore', { color: Logger.Colors.Blue })

const ChannelStore = Reflux.createStore({
  listenables: [AppActions, NetworkActions, ChannelActions],
  init: function() {
    this.channels = []
  },
  onInitialize: function(orbit) {
    this.orbit = orbit
  },
  // TODO: remove this function once nobody's using it anymore
  get: function(channel) {
    return this.channels[channel]
  },
  onDisconnect: function() {
    this.channels = []
    this.trigger(this.channels)
  },
  onJoinChannel: function(channel, password) {
    // TODO: check if still needed?
    if(channel === AppStateStore.state.currentChannel)
      return

    logger.debug(`Join channel #${channel}`)
    this.orbit.join(channel).then((channelName) => {
      logger.debug(`Joined channel #${channel}`)
      NetworkActions.joinedChannel(channel)
      this.channels = this.orbit.channels
      this.trigger(this.channels)
    })
  },
  onLeaveChannel: function(channel) {
    logger.debug(`Leave channel #${channel}`)
    this.orbit.leave(channel)
    this.channels = this.orbit.channels
    this.trigger(this.channels)
  }
})

export default ChannelStore
