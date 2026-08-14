export default {
  async fetch() {
    return new Response("fixture inbox unavailable", {status: 503});
  }
};
