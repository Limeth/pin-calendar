import EventEmitter from 'eventemitter3';

function onceAsync<
  EventTypes extends EventEmitter.ValidEventTypes,
  EventNames extends EventEmitter.EventNames<EventTypes>,
>(
  event: EventNames,
  fn: EventEmitter.EventListener<EventTypes, EventNames>,
  context?: Context,
): this {}
