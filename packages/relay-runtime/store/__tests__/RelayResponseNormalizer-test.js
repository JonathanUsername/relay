/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @emails oncall+relay
 */

'use strict';

jest.mock('generateClientID');

const RelayInMemoryRecordSource = require('../RelayInMemoryRecordSource');
const RelayModernRecord = require('../RelayModernRecord');
const {normalize} = require('../RelayResponseNormalizer');
const {ROOT_ID, ROOT_TYPE} = require('../RelayStoreUtils');
const RelayModernTestUtils = require('RelayModernTestUtils');

describe('RelayResponseNormalizer', () => {
  const {
    generateAndCompile,
    generateWithTransforms,
    matchers,
  } = RelayModernTestUtils;

  beforeEach(() => {
    jest.resetModules();
    expect.extend(matchers);
  });

  it('normalizes queries', () => {
    const {FooQuery} = generateWithTransforms(
      `
      query FooQuery($id: ID, $size: [Int]) {
        node(id: $id) {
          id
          __typename
          ... on User {
            firstName
            friends(first: 3) {
              edges {
                cursor
                node {
                  id
                  firstName
                }
              }
            }
            profilePicture(size: $size) {
              uri
            }
          }
        }
      }
    `,
    );
    const payload = {
      node: {
        id: '1',
        __typename: 'User',
        firstName: 'Alice',
        friends: {
          edges: [
            {
              cursor: 'cursor:2',
              node: {
                id: '2',
                firstName: 'Bob',
              },
            },
            null,
            {
              cursor: 'cursor:3',
              node: {
                id: '3',
                firstName: 'Claire',
              },
            },
          ],
        },
        profilePicture: {
          uri: 'https://...',
        },
      },
    };
    const recordSource = new RelayInMemoryRecordSource();
    recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
    normalize(
      recordSource,
      {
        dataID: ROOT_ID,
        node: FooQuery.operation,
        variables: {id: '1', size: 32},
      },
      payload,
    );
    const friendsID = 'client:1:friends(first:3)';
    const edgeID1 = `${friendsID}:edges:0`;
    const edgeID2 = `${friendsID}:edges:2`;
    const pictureID = 'client:1:profilePicture(size:32)';
    expect(recordSource.toJSON()).toEqual({
      '1': {
        __id: '1',
        id: '1',
        __typename: 'User',
        firstName: 'Alice',
        'friends(first:3)': {__ref: friendsID},
        'profilePicture(size:32)': {__ref: pictureID},
      },
      '2': {
        __id: '2',
        __typename: 'User',
        id: '2',
        firstName: 'Bob',
      },
      '3': {
        __id: '3',
        __typename: 'User',
        id: '3',
        firstName: 'Claire',
      },
      [friendsID]: {
        __id: friendsID,
        __typename: 'FriendsConnection',
        edges: {
          __refs: [edgeID1, null, edgeID2],
        },
      },
      [edgeID1]: {
        __id: edgeID1,
        __typename: 'FriendsEdge',
        cursor: 'cursor:2',
        node: {__ref: '2'},
      },
      [edgeID2]: {
        __id: edgeID2,
        __typename: 'FriendsEdge',
        cursor: 'cursor:3',
        node: {__ref: '3'},
      },
      [pictureID]: {
        __id: pictureID,
        __typename: 'Image',
        uri: 'https://...',
      },
      'client:root': {
        __id: 'client:root',
        __typename: '__Root',
        'node(id:"1")': {__ref: '1'},
      },
    });
  });

  it('normalizes queries with "handle" fields', () => {
    const {UserFriends} = generateAndCompile(`
      query UserFriends($id: ID!) {
        node(id: $id) {
          id
          __typename
          ... on User {
            friends(first: 1) @__clientField(handle: "bestFriends") {
              edges {
                cursor
                node {
                  id
                  name @__clientField(handle: "friendsName")
                }
              }
            }
          }
        }
      }
    `);

    const payload = {
      node: {
        id: '4',
        __typename: 'User',
        friends: {
          edges: [
            {
              cursor: 'cursor:bestFriends',
              node: {
                id: 'pet',
                name: 'Beast',
              },
            },
          ],
        },
      },
    };
    const recordSource = new RelayInMemoryRecordSource();
    recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
    const {fieldPayloads} = normalize(
      recordSource,
      {
        dataID: ROOT_ID,
        node: UserFriends.operation,
        variables: {id: '1'},
      },
      payload,
    );
    expect(recordSource.toJSON()).toMatchSnapshot();
    expect(fieldPayloads.length).toBe(2);
    expect(fieldPayloads[0]).toEqual({
      args: {},
      dataID: 'pet',
      fieldKey: 'name',
      handle: 'friendsName',
      handleKey: '__name_friendsName',
    });
    expect(fieldPayloads[1]).toEqual({
      args: {first: 1},
      dataID: '4',
      fieldKey: 'friends(first:1)',
      handle: 'bestFriends',
      handleKey: '__friends_bestFriends',
    });
  });

  it('normalizes queries with "filters"', () => {
    const {UserFriends} = generateAndCompile(`
      query UserFriends(
        $id: ID!,
        $orderBy: [String],
        $isViewerFriend: Boolean,
      ) {
        node(id: $id) {
          id
          __typename
          ... on User {
            friends(first: 1, orderby: $orderBy, isViewerFriend: $isViewerFriend)@__clientField(
              handle: "bestFriends",
              key: "UserFriends_friends",
              filters: ["orderby", "isViewerFriend"]
            ){
              edges {
                cursor
                node {
                  id
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `);

    const payload1 = {
      node: {
        id: '4',
        __typename: 'User',
        friends: {
          edges: [
            {
              cursor: 'cursor:bestFriends',
              node: {
                id: 'pet',
                name: 'Beast',
              },
            },
          ],
        },
      },
    };

    const recordSource = new RelayInMemoryRecordSource();
    recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
    let {fieldPayloads} = normalize(
      recordSource,
      {
        dataID: ROOT_ID,
        node: UserFriends.operation,
        variables: {id: '1', orderBy: ['last name'], isViewerFriend: true},
      },
      payload1,
    );
    expect(recordSource.toJSON()).toMatchSnapshot();
    expect(fieldPayloads.length).toBe(1);
    expect(fieldPayloads[0]).toEqual({
      args: {first: 1, orderby: ['last name'], isViewerFriend: true},
      dataID: '4',
      fieldKey: 'friends(first:1,isViewerFriend:true,orderby:["last name"])',
      handle: 'bestFriends',
      handleKey:
        '__UserFriends_friends_bestFriends(isViewerFriend:true,orderby:["last name"])',
    });

    const payload2 = {
      node: {
        id: '4',
        __typename: 'User',
        friends: {
          edges: [
            {
              cursor: 'cursor:bestFriends:2',
              node: {
                id: 'cat',
                name: 'Betty',
              },
            },
          ],
        },
      },
    };
    fieldPayloads = normalize(
      recordSource,
      {
        dataID: ROOT_ID,
        node: UserFriends.operation,
        variables: {id: '1', orderBy: ['first name'], isViewerFriend: true},
      },
      payload2,
    ).fieldPayloads;
    expect(recordSource.toJSON()).toMatchSnapshot();
    expect(fieldPayloads.length).toBe(1);
    expect(fieldPayloads[0]).toEqual({
      args: {first: 1, orderby: ['first name'], isViewerFriend: true},
      dataID: '4',
      fieldKey: 'friends(first:1,isViewerFriend:true,orderby:["first name"])',
      handle: 'bestFriends',
      handleKey:
        '__UserFriends_friends_bestFriends(isViewerFriend:true,orderby:["first name"])',
    });
  });

  describe('@match', () => {
    let BarQuery;

    beforeEach(() => {
      const nodes = generateAndCompile(`
        fragment PlainUserNameRenderer_name on PlainUserNameRenderer {
          plaintext
          data {
            text
          }
        }

        fragment MarkdownUserNameRenderer_name on MarkdownUserNameRenderer {
          markdown
          data {
            markup
          }
        }

        fragment BarFragment on User {
          id
          nameRenderer @match {
            ...PlainUserNameRenderer_name
              @module(name: "PlainUserNameRenderer.react")
            ...MarkdownUserNameRenderer_name
              @module(name: "MarkdownUserNameRenderer.react")
          }
        }

        query BarQuery($id: ID!) {
          node(id: $id) {
            ...BarFragment
          }
        }
      `);
      BarQuery = nodes.BarQuery;
    });

    it('normalizes queries correctly', () => {
      const payload = {
        node: {
          id: '1',
          __typename: 'User',
          nameRenderer: {
            __typename: 'MarkdownUserNameRenderer',
            __match_component: 'MarkdownUserNameRenderer.react',
            __match_fragment:
              'MarkdownUserNameRenderer_name$normalization.graphql',
            markdown: 'markdown payload',
            data: {
              markup: '<markup/>',
            },
          },
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {matchPayloads} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: BarQuery.operation,
          variables: {id: '1'},
        },
        payload,
      );
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          id: '1',
          __typename: 'User',
          'nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)': {
            __ref:
              'client:1:nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)',
          },
        },
        'client:1:nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)': {
          __id:
            'client:1:nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)',
          __typename: 'MarkdownUserNameRenderer',
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
      expect(matchPayloads).toEqual([
        {
          operationReference:
            'MarkdownUserNameRenderer_name$normalization.graphql',
          dataID:
            'client:1:nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)',
          data: {
            __typename: 'MarkdownUserNameRenderer',
            __match_component: 'MarkdownUserNameRenderer.react',
            __match_fragment:
              'MarkdownUserNameRenderer_name$normalization.graphql',
            markdown: 'markdown payload',
            data: {
              markup: '<markup/>',
            },
          },
          variables: {id: '1'},
          typeName: 'MarkdownUserNameRenderer',
          path: ['node', 'nameRenderer'],
        },
      ]);
    });

    it('returns metadata with prefixed path', () => {
      const payload = {
        node: {
          id: '1',
          __typename: 'User',
          nameRenderer: {
            __typename: 'MarkdownUserNameRenderer',
            __match_component: 'MarkdownUserNameRenderer.react',
            __match_fragment:
              'MarkdownUserNameRenderer_name$normalization.graphql',
            markdown: 'markdown payload',
            data: {
              markup: '<markup/>',
            },
          },
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {matchPayloads} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: BarQuery.operation,
          variables: {id: '1'},
        },
        payload,
        // simulate a nested @match that appeared, validate that nested payload
        // path is prefixed with this parent path:
        {path: ['abc', '0', 'xyz']},
      );
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          id: '1',
          __typename: 'User',
          'nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)': {
            __ref:
              'client:1:nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)',
          },
        },
        'client:1:nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)': {
          __id:
            'client:1:nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)',
          __typename: 'MarkdownUserNameRenderer',
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
      expect(matchPayloads).toEqual([
        {
          operationReference:
            'MarkdownUserNameRenderer_name$normalization.graphql',
          dataID:
            'client:1:nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)',
          data: {
            __typename: 'MarkdownUserNameRenderer',
            __match_component: 'MarkdownUserNameRenderer.react',
            __match_fragment:
              'MarkdownUserNameRenderer_name$normalization.graphql',
            markdown: 'markdown payload',
            data: {
              markup: '<markup/>',
            },
          },
          variables: {id: '1'},
          typeName: 'MarkdownUserNameRenderer',
          // parent path followed by local path to @match
          path: ['abc', '0', 'xyz', 'node', 'nameRenderer'],
        },
      ]);
    });

    it('normalizes queries correctly when the resolved type does not match any of the specified cases', () => {
      const payload = {
        node: {
          id: '1',
          __typename: 'User',
          nameRenderer: {
            __typename: 'CustomNameRenderer',
          },
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: BarQuery.operation,
          variables: {id: '1'},
        },
        payload,
      );
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          id: '1',
          __typename: 'User',
          'nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)': null,
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('normalizes queries correctly when the @match field is null', () => {
      const payload = {
        node: {
          id: '1',
          __typename: 'User',
          nameRenderer: null,
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: BarQuery.operation,
          variables: {id: '1'},
        },
        payload,
      );
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          id: '1',
          __typename: 'User',
          'nameRenderer(MarkdownUserNameRenderer_name:MarkdownUserNameRenderer.react,PlainUserNameRenderer_name:PlainUserNameRenderer.react)': null,
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });
  });

  describe('@defer', () => {
    it('normalizes when if condition is false', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on User {
            id
            name
          }

          query Query($id: ID!, $enableDefer: Boolean!) {
            node(id: $id) {
              ...TestFragment @defer(label: "TestFragment", if: $enableDefer)
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'User',
          name: 'Alice',
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1', enableDefer: false},
        },
        payload,
      );
      expect(incrementalPlaceholders).toEqual([]);
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('returns metadata when `if` is true (literal value)', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on User {
            id
            name
          }

          query Query($id: ID!) {
            node(id: $id) {
              ...TestFragment @defer(label: "TestFragment", if: true)
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'User',
          name: 'Alice',
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1'},
        },
        payload,
      );
      expect(incrementalPlaceholders).toEqual([
        {
          kind: 'defer',
          label: 'Query$defer$TestFragment',
          path: ['node'],
          selector: {
            dataID: '1',
            variables: {id: '1'},
            node: expect.objectContaining({kind: 'Defer'}),
          },
          typeName: 'User',
        },
      ]);
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          __typename: 'User',
          id: '1',
          // 'name' not normalized even though its present in the payload
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('returns metadata when `if` is true (variable value)', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on User {
            id
            name
          }

          query Query($id: ID!, $enableDefer: Boolean!) {
            node(id: $id) {
              ...TestFragment @defer(label: "TestFragment", if: $enableDefer)
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'User',
          name: 'Alice',
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1', enableDefer: true},
        },
        payload,
      );
      expect(incrementalPlaceholders).toEqual([
        {
          kind: 'defer',
          label: 'Query$defer$TestFragment',
          path: ['node'],
          selector: {
            dataID: '1',
            variables: {id: '1', enableDefer: true},
            node: expect.objectContaining({kind: 'Defer'}),
          },
          typeName: 'User',
        },
      ]);
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          __typename: 'User',
          id: '1',
          // 'name' not normalized even though its present in the payload
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('returns metadata for @defer within a plural', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on User {
            name
          }

          query Query($id: ID!) {
            node(id: $id) {
              ... on Feedback {
                actors {
                  ...TestFragment @defer(label: "TestFragment", if: true)
                }
              }
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'Feedback',
          actors: [
            {__typename: 'User', id: '2', name: 'Alice'},
            {__typename: 'User', id: '3', name: 'Bob'},
          ],
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1'},
        },
        payload,
      );
      expect(incrementalPlaceholders).toEqual([
        {
          kind: 'defer',
          label: 'Query$defer$TestFragment',
          path: ['node', 'actors', '0'],
          selector: {
            dataID: '2',
            variables: {id: '1'},
            node: expect.objectContaining({kind: 'Defer'}),
          },
          typeName: 'User',
        },
        {
          kind: 'defer',
          label: 'Query$defer$TestFragment',
          path: ['node', 'actors', '1'],
          selector: {
            dataID: '3',
            variables: {id: '1'},
            node: expect.objectContaining({kind: 'Defer'}),
          },
          typeName: 'User',
        },
      ]);
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          __typename: 'Feedback',
          id: '1',
          actors: {__refs: ['2', '3']},
        },
        '2': {
          __id: '2',
          __typename: 'User',
          id: '2',
          // name deferred
        },
        '3': {
          __id: '3',
          __typename: 'User',
          id: '3',
          // name deferred
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('returns metadata with prefixed path', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on User {
            id
            name
          }

          query Query($id: ID!) {
            node(id: $id) {
              ...TestFragment @defer(label: "TestFragment")
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'User',
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1'},
        },
        payload,
        // simulate a nested defer payload, verify that the incrementalPlaceholders
        // paths are prefixed with this parent path
        {path: ['abc', '0', 'xyz']},
      );
      expect(incrementalPlaceholders).toEqual([
        {
          kind: 'defer',
          label: 'Query$defer$TestFragment',
          path: ['abc', '0', 'xyz', 'node'],
          selector: {
            dataID: '1',
            variables: {id: '1'},
            node: expect.objectContaining({kind: 'Defer'}),
          },
          typeName: 'User',
        },
      ]);
    });
  });

  describe('@stream', () => {
    it('normalizes when if condition is false', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on Feedback {
            id
            actors @stream(label: "actors", if: $enableStream) {
              name
            }
          }

          query Query($id: ID!, $enableStream: Boolean!) {
            node(id: $id) {
              ...TestFragment
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'Feedback',
          actors: [{__typename: 'User', id: '2', name: 'Alice'}],
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1', enableStream: false},
        },
        payload,
      );
      expect(incrementalPlaceholders).toEqual([]);
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          __typename: 'Feedback',
          id: '1',
          actors: {__refs: ['2']},
        },
        '2': {
          __id: '2',
          __typename: 'User',
          id: '2',
          name: 'Alice',
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('normalizes and returns metadata when `if` is true (literal value)', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on Feedback {
            id
            actors @stream(label: "actors", if: true) {
              name
            }
          }

          query Query($id: ID!) {
            node(id: $id) {
              ...TestFragment
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'Feedback',
          actors: [{__typename: 'User', id: '2', name: 'Alice'}],
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1'},
        },
        payload,
      );
      expect(incrementalPlaceholders).toEqual([
        {
          kind: 'stream',
          label: 'TestFragment$stream$actors',
          path: ['node'],
          selector: {
            dataID: '1',
            variables: {id: '1'},
            node: expect.objectContaining({kind: 'Stream'}),
          },
          typeName: 'Feedback',
        },
      ]);
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          __typename: 'Feedback',
          id: '1',
          actors: {__refs: ['2']},
        },
        '2': {
          __id: '2',
          __typename: 'User',
          id: '2',
          name: 'Alice',
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('normalizes and returns metadata when `if` is true (variable value)', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on Feedback {
            id
            actors @stream(label: "actors", if: $enableStream) {
              name
            }
          }

          query Query($id: ID!, $enableStream: Boolean!) {
            node(id: $id) {
              ...TestFragment
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'Feedback',
          actors: [{__typename: 'User', id: '2', name: 'Alice'}],
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1', enableStream: true},
        },
        payload,
      );
      expect(incrementalPlaceholders).toEqual([
        {
          kind: 'stream',
          label: 'TestFragment$stream$actors',
          path: ['node'],
          selector: {
            dataID: '1',
            variables: {id: '1', enableStream: true},
            node: expect.objectContaining({kind: 'Stream'}),
          },
          typeName: 'Feedback',
        },
      ]);
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          __typename: 'Feedback',
          id: '1',
          actors: {__refs: ['2']},
        },
        '2': {
          __id: '2',
          __typename: 'User',
          id: '2',
          name: 'Alice',
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('normalizes and returns metadata for @stream within a plural', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on Feedback {
            id
            actors {
              ... on User {
                name
                actors @stream(label: "actors", if: true) {
                  name
                }
              }
            }
          }

          query Query($id: ID!) {
            node(id: $id) {
              ...TestFragment
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'Feedback',
          actors: [
            {__typename: 'User', id: '2', name: 'Alice', actors: []},
            {__typename: 'User', id: '3', name: 'Bob', actors: []},
          ],
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1'},
        },
        payload,
      );
      expect(incrementalPlaceholders).toEqual([
        {
          kind: 'stream',
          label: 'TestFragment$stream$actors',
          path: ['node', 'actors', '0'],
          selector: {
            dataID: '2',
            variables: {id: '1'},
            node: expect.objectContaining({kind: 'Stream'}),
          },
          typeName: 'User',
        },
        {
          kind: 'stream',
          label: 'TestFragment$stream$actors',
          path: ['node', 'actors', '1'],
          selector: {
            dataID: '3',
            variables: {id: '1'},
            node: expect.objectContaining({kind: 'Stream'}),
          },
          typeName: 'User',
        },
      ]);
      expect(recordSource.toJSON()).toEqual({
        '1': {
          __id: '1',
          __typename: 'Feedback',
          id: '1',
          actors: {__refs: ['2', '3']},
        },
        '2': {
          __id: '2',
          __typename: 'User',
          id: '2',
          name: 'Alice',
          actors: {__refs: []},
        },
        '3': {
          __id: '3',
          __typename: 'User',
          id: '3',
          name: 'Bob',
          actors: {__refs: []},
        },
        'client:root': {
          __id: 'client:root',
          __typename: '__Root',
          'node(id:"1")': {__ref: '1'},
        },
      });
    });

    it('returns metadata with prefixed path', () => {
      const {Query} = generateAndCompile(
        `
          fragment TestFragment on Feedback {
            id
            actors @stream(label: "actors") {
              name
            }
          }

          query Query($id: ID!) {
            node(id: $id) {
              ...TestFragment
            }
          }`,
      );
      const payload = {
        node: {
          id: '1',
          __typename: 'Feedback',
          actors: [{__typename: 'User', id: '2', name: 'Alice'}],
        },
      };

      const recordSource = new RelayInMemoryRecordSource();
      recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
      const {incrementalPlaceholders} = normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: Query.operation,
          variables: {id: '1'},
        },
        payload,
        // simulate a nested @match that appeared, validate that nested payload
        // path is prefixed with this parent path:
        {path: ['abc', '0', 'xyz']},
      );
      expect(incrementalPlaceholders).toEqual([
        {
          kind: 'stream',
          label: 'TestFragment$stream$actors',
          path: ['abc', '0', 'xyz', 'node'],
          selector: {
            dataID: '1',
            variables: {id: '1'},
            node: expect.objectContaining({kind: 'Stream'}),
          },
          typeName: 'Feedback',
        },
      ]);
    });
  });

  it('warns in __DEV__ if payload data is missing an expected field', () => {
    jest.mock('warning');

    const {BarQuery} = generateWithTransforms(
      `
      query BarQuery($id: ID) {
        node(id: $id) {
          id
          __typename
          ... on User {
            firstName
            profilePicture(size: 100) {
              uri
            }
          }
        }
      }
    `,
    );
    const payload = {
      node: {
        id: '1',
        __typename: 'User',
        profilePicture: {
          uri: 'https://...',
        },
      },
    };
    const recordSource = new RelayInMemoryRecordSource();
    recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
    expect(() => {
      normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: BarQuery.operation,
          variables: {id: '1'},
        },
        payload,
        {handleStrippedNulls: true},
      );
    }).toWarn([
      'RelayResponseNormalizer(): Payload did not contain a value for ' +
        'field `%s: %s`. Check that you are parsing with the same query that ' +
        'was used to fetch the payload.',
      'firstName',
      'firstName',
    ]);
  });

  it('does not warn in __DEV__ if payload data is missing for an abstract field', () => {
    jest.mock('warning');

    const {BarQuery} = generateAndCompile(`
      query BarQuery {
        named {
          name
          ... on Node {
            id
          }
        }
      }
    `);
    const payload = {
      named: {
        __typename: 'SimpleNamed',
        name: 'Alice',
      },
    };
    const recordSource = new RelayInMemoryRecordSource();
    recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
    expect(() => {
      normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: BarQuery.operation,
          variables: {},
        },
        payload,
        {handleStrippedNulls: true},
      );
    }).not.toWarn([
      'RelayResponseNormalizer(): Payload did not contain a value for ' +
        'field `%s: %s`. Check that you are parsing with the same query that ' +
        'was used to fetch the payload.',
      'name',
      'name',
    ]);
  });

  it('warns in __DEV__ if payload contains inconsistent types for a record', () => {
    jest.mock('warning');

    const {BarQuery} = generateWithTransforms(
      `
      query BarQuery($id: ID) {
        node(id: $id) {
          id
          __typename
          ... on User {
            actor {
              id
              __typename
            }
            actors {
              id
              __typename
            }
          }
        }
      }
    `,
    );
    const payload = {
      node: {
        id: '1',
        __typename: 'User',
        actor: {
          id: '1',
          __typename: 'Actor', // <- invalid
        },
        actors: [
          {
            id: '1',
            __typename: 'Actors', // <- invalid
          },
        ],
      },
    };
    const recordSource = new RelayInMemoryRecordSource();
    recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
    expect(() => {
      normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: BarQuery.operation,
          variables: {id: '1'},
        },
        payload,
        {handleStrippedNulls: true},
      );
    }).toWarn([
      'RelayResponseNormalizer: Invalid record `%s`. Expected %s to be ' +
        'be consistent, but the record was assigned conflicting types `%s` ' +
        'and `%s`. The GraphQL server likely violated the globally unique ' +
        'id requirement by returning the same id for different objects.',
      '1',
      '__typename',
      'User',
      'Actor',
    ]);
    expect(() => {
      normalize(
        recordSource,
        {
          dataID: ROOT_ID,
          node: BarQuery.operation,
          variables: {id: '1'},
        },
        payload,
        {handleStrippedNulls: true},
      );
    }).toWarn([
      'RelayResponseNormalizer: Invalid record `%s`. Expected %s to be ' +
        'be consistent, but the record was assigned conflicting types `%s` ' +
        'and `%s`. The GraphQL server likely violated the globally unique ' +
        'id requirement by returning the same id for different objects.',
      '1',
      '__typename',
      'Actor', // `User` is already overwritten when the plural field is reached
      'Actors',
    ]);
  });

  it('leaves undefined fields unset, as handleStrippedNulls == false', () => {
    const {StrippedQuery} = generateWithTransforms(
      `
      query StrippedQuery($id: ID, $size: [Int]) {
        node(id: $id) {
          id
          __typename
          ... on User {
            firstName
            profilePicture(size: $size) {
              uri
            }
          }
        }
      }
    `,
    );
    const payload = {
      node: {
        id: '1',
        __typename: 'User',
        firstName: 'Alice',
      },
    };
    const recordSource = new RelayInMemoryRecordSource();
    recordSource.set(ROOT_ID, RelayModernRecord.create(ROOT_ID, ROOT_TYPE));
    normalize(
      recordSource,
      {
        dataID: ROOT_ID,
        node: StrippedQuery.operation,
        variables: {id: '1', size: 32},
      },
      payload,
      {handleStrippedNulls: false},
    );
    expect(recordSource.toJSON()).toEqual({
      '1': {
        __id: '1',
        __typename: 'User',
        id: '1',
        firstName: 'Alice',
        // `profilePicture` is excluded
      },
      'client:root': {
        __id: 'client:root',
        __typename: '__Root',
        'node(id:"1")': {
          __ref: '1',
        },
      },
    });
  });
});
